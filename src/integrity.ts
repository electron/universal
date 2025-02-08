import * as fs from 'fs-extra';
import { minimatch } from 'minimatch';
import path from 'path';
import * as plist from 'plist';
import { MakeUniversalOpts } from '.';
import { AppFile, AppFileType } from './file-utils';

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
