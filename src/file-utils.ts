import { spawn } from '@malept/cross-spawn-promise';
import * as fs from 'fs-extra';
import * as path from 'path';

const MACHO_PREFIX = 'Mach-O ';

export enum AppFileType {
  MACHO,
  PLAIN,
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

      const fileOutput = await spawn('file', ['--brief', '--no-pad', p]).catch(() => '');
      if (p.includes('app.asar')) {
        fileType = AppFileType.APP_CODE;
      } else if (fileOutput.startsWith(MACHO_PREFIX)) {
        fileType = AppFileType.MACHO;
      } else if (p.endsWith('.bin')) {
        fileType = AppFileType.SNAPSHOT;
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
