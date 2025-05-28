import fs from 'node:fs';
import path from 'node:path';

import { AppFileType, getAllAppFiles } from './file-utils.js';
import { generateAsarIntegrity } from './asar-utils.js';

type IntegrityMap = {
  [filepath: string]: string;
};

export interface HeaderHash {
  algorithm: 'SHA256';
  hash: string;
}

export interface AsarIntegrity {
  [key: string]: HeaderHash;
}

export async function computeIntegrityData(contentsPath: string): Promise<AsarIntegrity> {
  const root = await fs.promises.realpath(contentsPath);

  const resourcesRelativePath = 'Resources';
  const resourcesPath = path.resolve(root, resourcesRelativePath);

  const resources = await getAllAppFiles(resourcesPath);
  const resourceAsars = resources
    .filter((file) => file.type === AppFileType.APP_CODE)
    .reduce<IntegrityMap>(
      (prev, file) => ({
        ...prev,
        [path.join(resourcesRelativePath, file.relativePath)]: path.join(
          resourcesPath,
          file.relativePath,
        ),
      }),
      {},
    );

  // sort to produce constant result
  const allAsars = Object.entries(resourceAsars).sort(([name1], [name2]) =>
    name1.localeCompare(name2),
  );
  const hashes = await Promise.all(allAsars.map(async ([, from]) => generateAsarIntegrity(from)));
  const asarIntegrity: AsarIntegrity = {};
  for (let i = 0; i < allAsars.length; i++) {
    const [asar] = allAsars[i];
    asarIntegrity[asar] = hashes[i];
  }
  return asarIntegrity;
}
