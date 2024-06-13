import { spawn } from '@malept/cross-spawn-promise';
import * as fs from 'fs-extra';
import * as path from 'path';

import { makeUniversalApp } from '../dist/cjs/index';

const appsPath = path.resolve(__dirname, 'fixtures', 'apps');
const appsOutPath = path.resolve(__dirname, 'fixtures', 'apps', 'out');

async function ensureUniversal(app: string) {
  const exe = path.resolve(app, 'Contents', 'MacOS', 'Electron');
  const result = await spawn(exe);
  expect(result).toContain('arm64');
  const result2 = await spawn('arch', ['-x86_64', exe]);
  expect(result2).toContain('x64');
}

// See `jest.setup.ts` for app fixture setup process
describe('makeUniversalApp', () => {
  afterEach(async () => {
    await fs.emptyDir(appsOutPath);
  });

  it('throws an error if asar is only detected in one arch', async () => {
    const out = path.resolve(appsOutPath, 'Error.app');
    await expect(
      makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64NoAsar.app'),
        outAppPath: out,
      }),
    ).rejects.toThrow(
      'Both the x64 and arm64 versions of your application need to have been built with the same asar settings (enabled vs disabled)',
    );
  });

  it.todo('works for lipo binary resources');

  describe('force', () => {
    it('throws an error if `out` bundle already exists and `force` is `false`', async () => {
      const out = path.resolve(appsOutPath, 'Error.app');
      await fs.mkdirp(out);
      await expect(
        makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
        }),
      ).rejects.toThrow(/The out path ".*" already exists and force is not set to true/);
    });

    it('packages successfully if `out` bundle already exists and `force` is `true`', async () => {
      const out = path.resolve(appsOutPath, 'Error.app');
      await fs.mkdirp(out);
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
        outAppPath: out,
        force: true,
      });
      await ensureUniversal(out);
      // Only a single asar as they were identical
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.endsWith('asar'),
        ),
      ).toEqual(['app.asar']);
    }, 60000);
  });

  describe('asar mode', () => {
    it('should correctly merge two identical asars', async () => {
      const out = path.resolve(appsOutPath, 'MergedAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
      // Only a single asar as they were identical
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.endsWith('asar'),
        ),
      ).toEqual(['app.asar']);
    }, 60000);

    it('should create a shim if asars are different between architectures', async () => {
      const out = path.resolve(appsOutPath, 'ShimmedAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
      // We have three asars including the arch-agnostic shim
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.endsWith('asar'),
        ),
      ).toEqual(['app.asar', 'app-x64.asar', 'app-arm64.asar']);
    }, 60000);

    it('should merge two different asars when `mergeASARs` is enabled', async () => {
      const out = path.resolve(appsOutPath, 'MergedAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
        outAppPath: out,
        mergeASARs: true,
        singleArchFiles: 'extra-file.txt',
      });
      await ensureUniversal(out);
      // Only a single merged asar
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.endsWith('asar'),
        ),
      ).toEqual(['app.asar']);
    }, 60000);

    it('throws an error if `mergeASARs` is enabled and `singleArchFiles` is missing a unique file', async () => {
      const out = path.resolve(appsOutPath, 'Error.app');
      await expect(
        makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
          outAppPath: out,
          mergeASARs: true,
          singleArchFiles: 'bad-rule',
        }),
      ).rejects.toThrow(/Detected unique file "extra-file\.txt"/);
    }, 60000);

    it.todo('should not inject ElectronAsarIntegrity into `infoPlistsToIgnore`');
  });

  describe('no asar mode', () => {
    it('should correctly merge two identical app folders', async () => {
      const out = path.resolve(appsOutPath, 'MergedNoAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64NoAsar.app'),
        arm64AppPath: path.resolve(appsPath, 'Arm64NoAsar.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
      // Only a single app folder as they were identical
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.startsWith('app'),
        ),
      ).toEqual(['app']);
    }, 60000);

    it.todo('should shim two different app folders');
  });

  // TODO: Add tests for
  // * different app dirs with different macho files
  // * identical app dirs with universal macho files
});
