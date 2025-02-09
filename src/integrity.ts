import * as fs from 'fs-extra';
import { minimatch } from 'minimatch';
import path from 'path';
import * as plist from 'plist';
import { MakeUniversalOpts } from '.';
import { AppFile, AppFileType, getAllAppFiles } from './file-utils';
import { readdir } from 'fs-extra';
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

export async function injectAsarIntegrity(
  x64Files: AppFile[],
  opts: MakeUniversalOpts,
  generatedIntegrity: Record<string, { algorithm: 'SHA256'; hash: string }>,
  tmpApp: string,
) {
  const plistFiles = x64Files.filter((f) => f.type === AppFileType.INFO_PLIST);
  for (const plistFile of plistFiles) {
    const x64PlistPath = path.resolve(opts.x64AppPath, plistFile.relativePath);
    const arm64PlistPath = path.resolve(opts.arm64AppPath, plistFile.relativePath);

    const { ElectronAsarIntegrity: x64Integrity, ...x64Plist } = plist.parse(
      await fs.readFile(x64PlistPath, 'utf8'),
    ) as any;
    const { ElectronAsarIntegrity: arm64Integrity, ...arm64Plist } = plist.parse(
      await fs.readFile(arm64PlistPath, 'utf8'),
    ) as any;
    if (JSON.stringify(x64Plist) !== JSON.stringify(arm64Plist)) {
      throw new Error(
        `Expected all Info.plist files to be identical when ignoring integrity when creating a universal build but "${plistFile.relativePath}" was not`,
      );
    }

    const injectAsarIntegrity =
      !opts.infoPlistsToIgnore ||
      minimatch(plistFile.relativePath, opts.infoPlistsToIgnore, { matchBase: true });
    const mergedPlist = injectAsarIntegrity
      ? { ...x64Plist, ElectronAsarIntegrity: generatedIntegrity }
      : { ...x64Plist };

    await fs.writeFile(path.resolve(tmpApp, plistFile.relativePath), plist.build(mergedPlist));
  }
}

export async function computeIntegrityData(contentsPath: string): Promise<AsarIntegrity> {
  const resourcesRelativePath = 'Resources';
  const resourcesPath = path.join(contentsPath, resourcesRelativePath);
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
