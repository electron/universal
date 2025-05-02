import { spawn, ExitCodeError } from '@malept/cross-spawn-promise';
import * as fs from 'fs-extra';
import * as path from 'path';
import { promises as stream } from 'node:stream';

const MACHO_PREFIX = 'Mach-O ';

export enum AppFileType {
  MACHO,
  PLAIN,
  INFO_PLIST,
  SNAPSHOT,
  APP_CODE,
}

export type AppFile = {
  relativePath: string;
  type: AppFileType;
};

/**
 *
 * @param appPath Path to the application
 */
export const getAllAppFiles = async (appPath: string): Promise<AppFile[]> => {
  const files: AppFile[] = [];

  const visited = new Set<string>();
  const traverse = async (p: string) => {
    p = await fs.realpath(p);
    if (visited.has(p)) return;
    visited.add(p);

    const info = await fs.stat(p);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
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
      } else if (fileOutput.startsWith(MACHO_PREFIX)) {
        fileType = AppFileType.MACHO;
      } else if (p.endsWith('.bin')) {
        fileType = AppFileType.SNAPSHOT;
      } else if (path.basename(p) === 'Info.plist') {
        fileType = AppFileType.INFO_PLIST;
      }

      files.push({
        relativePath: path.relative(appPath, p),
        type: fileType,
      });
    }

    if (info.isDirectory()) {
      for (const child of await fs.readdir(p)) {
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
