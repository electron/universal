import fs from 'node:fs';
import path from 'node:path';
import { promises as stream } from 'node:stream';

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

/**
 * Glob match with matchBase semantics: if the pattern contains no `/`,
 * only the basename of `filePath` is tested against the pattern.
 */
export const matchGlob = (filePath: string, pattern: string): boolean => {
  return path.matchesGlob(pattern.includes('/') ? filePath : path.basename(filePath), pattern);
};

export type DiffEntry = {
  state: 'equal' | 'distinct' | 'left' | 'right';
  name1?: string;
  relativePath: string;
};

export async function compareDirectories(dir1: string, dir2: string): Promise<DiffEntry[]> {
  async function getFiles(dir: string, rel = ''): Promise<Map<string, string>> {
    const entries = new Map<string, string>();
    for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      const relPath = rel ? path.join(rel, item.name) : item.name;
      // For symlinks, stat the target to determine if it's a file or directory
      const isDir =
        item.isDirectory() ||
        (item.isSymbolicLink() && (await fs.promises.stat(fullPath)).isDirectory());
      if (isDir) {
        for (const [k, v] of await getFiles(fullPath, relPath)) {
          entries.set(k, v);
        }
      } else if (item.isFile() || item.isSymbolicLink()) {
        entries.set(relPath, fullPath);
      }
    }
    return entries;
  }

  const files1 = await getFiles(dir1);
  const files2 = await getFiles(dir2);
  const results: DiffEntry[] = [];

  for (const relFile of new Set([...files1.keys(), ...files2.keys()])) {
    const name = path.basename(relFile);
    const relDir = path.dirname(relFile);
    const relativePath = relDir === '.' ? '' : relDir;

    if (!files1.has(relFile)) {
      results.push({ state: 'right', relativePath });
      continue;
    }
    if (!files2.has(relFile)) {
      results.push({ state: 'left', name1: name, relativePath });
      continue;
    }

    const content1 = await fs.promises.readFile(files1.get(relFile)!);
    const content2 = await fs.promises.readFile(files2.get(relFile)!);
    results.push({
      state: content1.equals(content2) ? 'equal' : 'distinct',
      name1: name,
      relativePath,
    });
  }

  return results;
}

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

  return matchGlob(unpackedPath, opts.singleArchFiles);
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
