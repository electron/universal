import * as fs from 'fs-extra';
import * as path from 'path';

export enum AsarMode {
  NO_ASAR,
  HAS_ASAR,
}

export const detectAsarMode = async (appPath: string) => {
  const asarPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar');

  if (!(await fs.pathExists(asarPath))) return AsarMode.NO_ASAR;

  return AsarMode.HAS_ASAR;
};
