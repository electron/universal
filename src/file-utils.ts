import fs from 'node:fs';
import path from 'node:path';
import { promises as stream } from 'node:stream';

import { minimatch } from 'minimatch';

// See: https://github.com/apple-opensource-mirror/llvmCore/blob/0c60489d96c87140db9a6a14c6e82b15f5e5d252/include/llvm/Object/MachOFormat.h#L108-L112
export const MACHO_MAGIC = new Set([
  // 32-bit Mach-O
  0xfeedface, 0xcefaedfe,

  // 64-bit Mach-O
  0xfeedfacf, 0xcffaedfe,
]);

export const MACHO_UNIVERSAL_MAGIC = new Set([
  // universal
  0xcafebabe, 0xbebafeca,
]);

// Java .class files share the 0xCAFEBABE magic with Mach-O fat binaries. For
// Mach-O, bytes 4-7 encode nfat_arch (a small integer); for Java they encode
// (minor_version << 16 | major_version) where major_version >= 45. Any value
// below 30 is safely Mach-O.
const FAT_ARCH_DISAMBIGUATION_THRESHOLD = 30;

export const isMachO = (header: Buffer): boolean => {
  if (header.length < 4) return false;
  const magic = header.readUInt32LE(0);
  if (MACHO_MAGIC.has(magic)) return true;
  if (MACHO_UNIVERSAL_MAGIC.has(magic)) {
    if (header.length < 8) return true;
    return header.readUInt32BE(4) < FAT_ARCH_DISAMBIGUATION_THRESHOLD;
  }
  return false;
};

const UNPACKED_ASAR_PATH = path.join('Contents', 'Resources', 'app.asar.unpacked');

export enum AppFileType {
  MACHO,
  PLAIN,
  INFO_PLIST,
  SNAPSHOT,
  APP_CODE,
  SINGLE_ARCH,
}

export type AppFile = {
  relativePath: string;
  type: AppFileType;
};

export type GetAllAppFilesOpts = {
  singleArchFiles?: string;
};

const isSingleArchFile = (relativePath: string, opts: GetAllAppFilesOpts): boolean => {
  if (opts.singleArchFiles === undefined) {
    return false;
  }

  const unpackedPath = path.relative(UNPACKED_ASAR_PATH, relativePath);

  // Outside of app.asar.unpacked
  if (unpackedPath.startsWith('..')) {
    return false;
  }

  return minimatch(unpackedPath, opts.singleArchFiles, {
    matchBase: true,
  });
};

/**
 *
 * @param appPath Path to the application
 */
export const getAllAppFiles = async (
  appPath: string,
  opts: GetAllAppFilesOpts,
): Promise<AppFile[]> => {
  appPath = await fs.promises.realpath(appPath);

  const files: AppFile[] = [];

  const visited = new Set<string>();
  const traverse = async (p: string) => {
    p = await fs.promises.realpath(p);
    if (visited.has(p)) return;
    visited.add(p);

    const info = await fs.promises.stat(p);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      const relativePath = path.relative(appPath, p);

      let fileType = AppFileType.PLAIN;

      if (p.endsWith('.asar')) {
        fileType = AppFileType.APP_CODE;
      } else if (isSingleArchFile(relativePath, opts)) {
        fileType = AppFileType.SINGLE_ARCH;
      } else if (isMachO(await readMachOHeader(p))) {
        fileType = AppFileType.MACHO;
      } else if (p.endsWith('.bin')) {
        fileType = AppFileType.SNAPSHOT;
      } else if (path.basename(p) === 'Info.plist') {
        fileType = AppFileType.INFO_PLIST;
      }

      files.push({
        relativePath,
        type: fileType,
      });
    }

    if (info.isDirectory()) {
      for (const child of await fs.promises.readdir(p)) {
        await traverse(path.resolve(p, child));
      }
    }
  };
  await traverse(appPath);

  return files;
};

export const readMachOHeader = async (path: string) => {
  const chunks: Buffer[] = [];
  // no need to read the entire file, we only need the first 8 bytes to
  // identify the Mach-O magic (and disambiguate fat binaries from Java .class)
  await stream.pipeline(fs.createReadStream(path, { start: 0, end: 7 }), async function* (source) {
    for await (const chunk of source) {
      chunks.push(chunk);
    }
  });
  return Buffer.concat(chunks);
};

export const fsMove = async (oldPath: string, newPath: string) => {
  try {
    await fs.promises.rename(oldPath, newPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      // Cross-device link, fallback to copy and delete
      await fs.promises.cp(oldPath, newPath, {
        force: true,
        recursive: true,
        verbatimSymlinks: true,
      });
      await fs.promises.rm(oldPath, { force: true, recursive: true });
    } else {
      throw err;
    }
  }
};
