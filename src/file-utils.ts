import * as fs from 'fs-extra';
import * as path from 'path';
import { getFileArch } from './asar-utils';

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

      if (p.includes('app.asar')) {
        fileType = AppFileType.APP_CODE;
      } else if ((await getFileArch(p)).startsWith(MACHO_PREFIX)) {
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
