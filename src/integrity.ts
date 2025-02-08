import { readdir } from 'fs-extra';
import path from 'path';
import { AppFileType, getAllAppFiles } from './file-utils';
import { sha } from './sha';

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

export async function computeIntegrityData(
  resourcesPath: string,
  resourcesRelativePath: string,
): Promise<AsarIntegrity> {
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
  const hashes = await Promise.all(allAsars.map(async ([, from]) => sha(from)));
  const asarIntegrity: AsarIntegrity = {};
  for (let i = 0; i < allAsars.length; i++) {
    const [asar] = allAsars[i];
    asarIntegrity[asar] = hashes[i];
  }
  return asarIntegrity;
}
