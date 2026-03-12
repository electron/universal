import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, it } from 'vitest';

import { makeUniversalApp } from '../dist/index.js';
import { fsMove } from '../src/file-utils.js';
import {
  createStagingAppDir,
  generateNativeApp,
  templateApp,
  VERIFY_APP_TIMEOUT,
  verifyApp,
} from './util.js';
import { createPackage, createPackageWithOptions } from '@electron/asar';

const appsPath = path.resolve(import.meta.dirname, 'fixtures', 'apps');

const tmpDirs: string[] = [];
const mkOutDir = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-universal-test-'));
  tmpDirs.push(dir);
  return dir;
};

// See `globalSetup.ts` for app fixture setup process
describe.concurrent('makeUniversalApp', () => {
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.promises.rm(d, { force: true, recursive: true })));
  });

  it('throws an error if asar is only detected in one arch', async ({ expect }) => {
    const out = path.resolve(await mkOutDir(), 'Error.app');
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

  it('works for lipo binary resources', { timeout: VERIFY_APP_TIMEOUT }, async ({ expect }) => {
    const x64AppPath = await generateNativeApp({
      appNameWithExtension: 'LipoX64.app',
      arch: 'x64',
      createAsar: true,
    });
    const arm64AppPath = await generateNativeApp({
      appNameWithExtension: 'LipoArm64.app',
      arch: 'arm64',
      createAsar: true,
    });

    const out = path.resolve(await mkOutDir(), 'Lipo.app');
    await makeUniversalApp({ x64AppPath, arm64AppPath, outAppPath: out, mergeASARs: true });
    await verifyApp(expect, out, true);
  });

  describe('force', () => {
    it('throws an error if `out` bundle already exists and `force` is `false`', async ({
      expect,
    }) => {
      const out = path.resolve(await mkOutDir(), 'Error.app');
      await fs.promises.mkdir(out, { recursive: true });
      await expect(
        makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
        }),
      ).rejects.toThrow(/The out path ".*" already exists and force is not set to true/);
    });

    it(
      'packages successfully if `out` bundle already exists and `force` is `true`',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'NoError.app');
        await fs.promises.mkdir(out, { recursive: true });
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
          force: true,
        });
        await verifyApp(expect, out);
      },
    );
  });

  describe('asar mode', () => {
    it(
      'should correctly merge two identical asars',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'MergedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
        });
        await verifyApp(expect, out);
      },
    );

    it(
      'should create a shim if asars are different between architectures',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'ShimmedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
          outAppPath: out,
        });
        await verifyApp(expect, out);
      },
    );

    it(
      'should merge two different asars when `mergeASARs` is enabled',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'MergedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
          outAppPath: out,
          mergeASARs: true,
          singleArchFiles: 'extra-file.txt',
        });
        await verifyApp(expect, out);
      },
    );

    it(
      'throws an error if `mergeASARs` is enabled and `singleArchFiles` is missing a unique file',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'Error.app');
        await expect(
          makeUniversalApp({
            x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
            arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
            outAppPath: out,
            mergeASARs: true,
            singleArchFiles: 'bad-rule',
          }),
        ).rejects.toThrow(/Detected unique file "extra-file\.txt"/);
      },
    );

    it(
      'should merge two different asars with native files when `mergeASARs` is enabled',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'SingleArchFiles-x64.app',
          arch: 'x64',
          createAsar: true,
          singleArchBindings: true,
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'SingleArchFiles-arm64.app',
          arch: 'arm64',
          createAsar: true,
          singleArchBindings: true,
        });
        const out = path.resolve(await mkOutDir(), 'SingleArchFiles.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath: out,
          mergeASARs: true,
          singleArchFiles: 'hello-world-*',
        });
        await verifyApp(expect, out, true);
      },
    );

    it(
      'throws an error if `mergeASARs` is enabled and `singleArchFiles` is missing a unique native file',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'SingleArchFiles-2-x64.app',
          arch: 'x64',
          createAsar: true,
          singleArchBindings: true,
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'SingleArchFiles-2-arm64.app',
          arch: 'arm64',
          createAsar: true,
          singleArchBindings: true,
        });
        const out = path.resolve(await mkOutDir(), 'SingleArchFiles-2.app');
        await expect(
          makeUniversalApp({
            x64AppPath,
            arm64AppPath,
            outAppPath: out,
            mergeASARs: true,
            singleArchFiles: 'bad-rule',
          }),
        ).rejects.toThrow(
          /the number of mach-o files is not the same between the arm64 and x64 builds/,
        );
      },
    );

    it(
      'should not inject ElectronAsarIntegrity into `infoPlistsToIgnore`',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const arm64AppPath = await templateApp('Arm64-1.app', 'arm64', async (appPath) => {
          const { testPath } = await createStagingAppDir('Arm64-1');
          await createPackage(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app.asar'));
          await templateApp('SubApp-1.app', 'arm64', async (subArm64AppPath) => {
            await fsMove(
              subArm64AppPath,
              path.resolve(appPath, 'Contents', 'Resources', path.basename(subArm64AppPath)),
            );
          });
        });
        const x64AppPath = await templateApp('X64-1.app', 'x64', async (appPath) => {
          const { testPath } = await createStagingAppDir('X64-1');
          await createPackage(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app.asar'));
          await templateApp('SubApp-1.app', 'x64', async (subArm64AppPath) => {
            await fsMove(
              subArm64AppPath,
              path.resolve(appPath, 'Contents', 'Resources', path.basename(subArm64AppPath)),
            );
          });
        });
        const outAppPath = path.resolve(await mkOutDir(), 'UnmodifiedPlist.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
          mergeASARs: true,
          infoPlistsToIgnore: 'SubApp-1.app/Contents/Info.plist',
        });
        await verifyApp(expect, outAppPath);
      },
    );

    // TODO: Investigate if this should even be allowed.
    // Current logic detects all unpacked files as APP_CODE, which doesn't seem correct since it could also be a macho file requiring lipo
    // https://github.com/electron/universal/blob/d90d573ccf69a5b14b91aa818c8b97e0e6840399/src/file-utils.ts#L48-L49
    it.skip(
      'should shim asars with different unpacked dirs',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const arm64AppPath = await templateApp('UnpackedArm64.app', 'arm64', async (appPath) => {
          const { testPath } = await createStagingAppDir('UnpackedAppArm64');
          await createPackageWithOptions(
            testPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
            {
              unpackDir: 'var',
              unpack: '*.txt',
            },
          );
        });

        const x64AppPath = await templateApp('UnpackedX64.app', 'x64', async (appPath) => {
          const { testPath } = await createStagingAppDir('UnpackedAppX64');
          await createPackageWithOptions(
            testPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
            {},
          );
        });

        const outAppPath = path.resolve(await mkOutDir(), 'UnpackedDir.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(expect, outAppPath);
      },
    );

    it(
      'should generate AsarIntegrity for all asars in the application',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const { testPath } = await createStagingAppDir('app-2');
        const testAsarPath = path.resolve(await mkOutDir(), 'app-2.asar');
        await createPackage(testPath, testAsarPath);

        const arm64AppPath = await templateApp('Arm64-2.app', 'arm64', async (appPath) => {
          await fs.promises.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
          );
          await fs.promises.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'webapp.asar'),
          );
        });
        const x64AppPath = await templateApp('X64-2.app', 'x64', async (appPath) => {
          await fs.promises.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
          );
          await fs.promises.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'webbapp.asar'),
          );
        });
        const outAppPath = path.resolve(await mkOutDir(), 'MultipleAsars.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
          mergeASARs: true,
        });
        await verifyApp(expect, outAppPath);
      },
    );
  });

  describe('no asar mode', () => {
    it(
      'should correctly merge two identical app folders',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const out = path.resolve(await mkOutDir(), 'MergedNoAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64NoAsar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64NoAsar.app'),
          outAppPath: out,
        });
        await verifyApp(expect, out);
      },
    );

    it(
      'should shim two different app folders',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const arm64AppPath = await templateApp('ShimArm64.app', 'arm64', async (appPath) => {
          const { testPath } = await createStagingAppDir('shimArm64', {
            'i-aint-got-no-rhythm.bin': 'boomshakalaka',
          });
          await fs.promises.cp(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app'), {
            recursive: true,
            verbatimSymlinks: true,
          });
        });

        const x64AppPath = await templateApp('ShimX64.app', 'x64', async (appPath) => {
          const { testPath } = await createStagingAppDir('shimX64', {
            'hello-world.bin': 'Hello World',
          });
          await fs.promises.cp(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app'), {
            recursive: true,
            verbatimSymlinks: true,
          });
        });

        const outAppPath = path.resolve(await mkOutDir(), 'ShimNoAsar.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(expect, outAppPath);
      },
    );

    it(
      'different app dirs with different macho files (shim and lipo)',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentMachoAppX64-1.app',
          arch: 'x64',
          createAsar: false,
          additionalFiles: {
            'hello-world.bin': 'Hello World',
          },
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentMachoAppArm64-1.app',
          arch: 'arm64',
          createAsar: false,
          additionalFiles: {
            'i-aint-got-no-rhythm.bin': 'boomshakalaka',
          },
        });

        const outAppPath = path.resolve(await mkOutDir(), 'DifferentMachoApp1.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(expect, outAppPath, true);
      },
    );

    it(
      "different app dirs with universal macho files (shim but don't lipo)",
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentButUniversalMachoAppX64-2.app',
          arch: 'x64',
          createAsar: false,
          nativeModuleArch: 'universal',
          additionalFiles: {
            'hello-world.bin': 'Hello World',
          },
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentButUniversalMachoAppArm64-2.app',
          arch: 'arm64',
          createAsar: false,
          nativeModuleArch: 'universal',
          additionalFiles: {
            'i-aint-got-no-rhythm.bin': 'boomshakalaka',
          },
        });

        const outAppPath = path.resolve(await mkOutDir(), 'DifferentButUniversalMachoApp.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(expect, outAppPath, true);
      },
    );

    it(
      'identical app dirs with different macho files (e.g. do not shim, but still lipo)',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentMachoAppX64-2.app',
          arch: 'x64',
          createAsar: false,
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'DifferentMachoAppArm64-2.app',
          arch: 'arm64',
          createAsar: false,
        });

        const out = path.resolve(await mkOutDir(), 'DifferentMachoApp2.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath: out,
        });
        await verifyApp(expect, out, true);
      },
    );

    it(
      'identical app dirs with universal macho files (e.g., do not shim, just copy x64 dir)',
      { timeout: VERIFY_APP_TIMEOUT },
      async ({ expect }) => {
        const x64AppPath = await generateNativeApp({
          appNameWithExtension: 'UniversalMachoAppX64.app',
          arch: 'x64',
          createAsar: false,
          nativeModuleArch: 'universal',
        });
        const arm64AppPath = await generateNativeApp({
          appNameWithExtension: 'UniversalMachoAppArm64.app',
          arch: 'arm64',
          createAsar: false,
          nativeModuleArch: 'universal',
        });

        const out = path.resolve(await mkOutDir(), 'UniversalMachoApp.app');
        await makeUniversalApp({ x64AppPath, arm64AppPath, outAppPath: out });
        await verifyApp(expect, out, true);
      },
    );
  });
});
