import * as asar from 'asar';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { d } from './debug';

export enum AsarMode {
  NO_ASAR,
  HAS_ASAR,
}

export const detectAsarMode = async (appPath: string) => {
  d('checking asar mode of', appPath);
  const asarPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar');

  if (!(await fs.pathExists(asarPath))) {
    d('determined no asar');
    return AsarMode.NO_ASAR;
  }

  d('determined has asar');
  return AsarMode.HAS_ASAR;
};

export const generateAsarIntegrity = (asarPath: string) => {
  return {
    algorithm: 'SHA256' as const,
    hash: crypto
      .createHash('SHA256')
      .update(asar.getRawHeader(asarPath).headerString)
      .digest('hex'),
  };
};
