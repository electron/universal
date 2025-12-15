import fs from 'node:fs';
import path from 'node:path';
import { promises as stream } from 'node:stream';

import { spawn, ExitCodeError } from '@malept/cross-spawn-promise';
import { minimatch } from 'minimatch';

const MACHO_PREFIX = 'Mach-O ';

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
  const unpackedPath = path.join('Contents', 'Resources', 'app.asar.unpacked');

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

      var fileOutput = '';
      try {
        fileOutput = await spawn('file', ['--brief', '--no-pad', p]);
      } catch (e) {
        if (e instanceof ExitCodeError) {
          /* silently accept error codes from "file" */
        } else {
          throw e;
        }
      }
      if (p.endsWith('.asar')) {
        fileType = AppFileType.APP_CODE;
      } else if (isSingleArchFile(relativePath, opts)) {
        fileType = AppFileType.SINGLE_ARCH;
      } else if (fileOutput.startsWith(MACHO_PREFIX)) {
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
  // no need to read the entire file, we only need the first 4 bytes of the file to determine the header
  await stream.pipeline(fs.createReadStream(path, { start: 0, end: 3 }), async function* (source) {
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
