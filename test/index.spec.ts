import * as fs from 'fs-extra';
import * as path from 'path';

import { makeUniversalApp } from '../dist/cjs/index';
import { createTestApp, templateApp, VERIFY_APP_TIMEOUT, verifyApp } from './util';
import { createPackage, createPackageWithOptions } from '@electron/asar';
import { afterEach, describe, expect, it } from '@jest/globals';

const appsPath = path.resolve(__dirname, 'fixtures', 'apps');
const appsOutPath = path.resolve(__dirname, 'fixtures', 'apps', 'out');

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

    it(
      'packages successfully if `out` bundle already exists and `force` is `true`',
      async () => {
        const out = path.resolve(appsOutPath, 'Error.app');
        await fs.mkdirp(out);
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
          force: true,
        });
        await verifyApp(out);
      },
      VERIFY_APP_TIMEOUT,
    );
  });

  describe('asar mode', () => {
    it(
      'should correctly merge two identical asars',
      async () => {
        const out = path.resolve(appsOutPath, 'MergedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64Asar.app'),
          outAppPath: out,
        });
        await verifyApp(out);
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'should create a shim if asars are different between architectures',
      async () => {
        const out = path.resolve(appsOutPath, 'ShimmedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
          outAppPath: out,
        });
        await verifyApp(out);
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'should merge two different asars when `mergeASARs` is enabled',
      async () => {
        const out = path.resolve(appsOutPath, 'MergedAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64AsarExtraFile.app'),
          outAppPath: out,
          mergeASARs: true,
          singleArchFiles: 'extra-file.txt',
        });
        await verifyApp(out);
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'throws an error if `mergeASARs` is enabled and `singleArchFiles` is missing a unique file',
      async () => {
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
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'should not inject ElectronAsarIntegrity into `infoPlistsToIgnore`',
      async () => {
        const arm64AppPath = await templateApp('Arm64-1.app', 'arm64', async (appPath) => {
          const { testPath } = await createTestApp('Arm64-1');
          await createPackage(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app.asar'));
          await templateApp('SubApp-1.app', 'arm64', async (subArm64AppPath) => {
            await fs.move(
              subArm64AppPath,
              path.resolve(appPath, 'Contents', 'Resources', path.basename(subArm64AppPath)),
            );
          });
        });
        const x64AppPath = await templateApp('X64-1.app', 'x64', async (appPath) => {
          const { testPath } = await createTestApp('X64-1');
          await createPackage(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app.asar'));
          await templateApp('SubApp-1.app', 'x64', async (subArm64AppPath) => {
            await fs.move(
              subArm64AppPath,
              path.resolve(appPath, 'Contents', 'Resources', path.basename(subArm64AppPath)),
            );
          });
        });
        const outAppPath = path.resolve(appsOutPath, 'UnmodifiedPlist.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
          mergeASARs: true,
          infoPlistsToIgnore: 'SubApp-1.app/Contents/Info.plist',
        });
        await verifyApp(outAppPath);
      },
      VERIFY_APP_TIMEOUT,
    );

    // TODO: Investigate if this should even be allowed.
    // Current logic detects all unpacked files as APP_CODE, which doesn't seem correct since it could also be a macho file requiring lipo
    // https://github.com/electron/universal/blob/d90d573ccf69a5b14b91aa818c8b97e0e6840399/src/file-utils.ts#L48-L49
    it.skip(
      'should shim asars with different unpacked dirs',
      async () => {
        const arm64AppPath = await templateApp('UnpackedArm64.app', 'arm64', async (appPath) => {
          const { testPath } = await createTestApp('UnpackedAppArm64');
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
          const { testPath } = await createTestApp('UnpackedAppX64');
          await createPackageWithOptions(
            testPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
            {},
          );
        });

        const outAppPath = path.resolve(appsOutPath, 'UnpackedDir.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(outAppPath);
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'should generate AsarIntegrity for all asars in the application',
      async () => {
        const { testPath } = await createTestApp('app-2');
        const testAsarPath = path.resolve(appsOutPath, 'app-2.asar');
        await createPackage(testPath, testAsarPath);

        const arm64AppPath = await templateApp('Arm64-2.app', 'arm64', async (appPath) => {
          await fs.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
          );
          await fs.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'webapp.asar'),
          );
        });
        const x64AppPath = await templateApp('X64-2.app', 'x64', async (appPath) => {
          await fs.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
          );
          await fs.copyFile(
            testAsarPath,
            path.resolve(appPath, 'Contents', 'Resources', 'webbapp.asar'),
          );
        });
        const outAppPath = path.resolve(appsOutPath, 'MultipleAsars.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
          mergeASARs: true,
        });
        await verifyApp(outAppPath);
      },
      VERIFY_APP_TIMEOUT,
    );
  });

  describe('no asar mode', () => {
    it(
      'should correctly merge two identical app folders',
      async () => {
        const out = path.resolve(appsOutPath, 'MergedNoAsar.app');
        await makeUniversalApp({
          x64AppPath: path.resolve(appsPath, 'X64NoAsar.app'),
          arm64AppPath: path.resolve(appsPath, 'Arm64NoAsar.app'),
          outAppPath: out,
        });
        await verifyApp(out);
      },
      VERIFY_APP_TIMEOUT,
    );

    it(
      'should shim two different app folders',
      async () => {
        const arm64AppPath = await templateApp('ShimArm64.app', 'arm64', async (appPath) => {
          const { testPath } = await createTestApp('shimArm64', {
            'i-aint-got-no-rhythm.bin': 'boomshakalaka',
          });
          await fs.copy(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app'));
        });

        const x64AppPath = await templateApp('ShimX64.app', 'x64', async (appPath) => {
          const { testPath } = await createTestApp('shimX64', { 'hello-world.bin': 'Hello World' });
          await fs.copy(testPath, path.resolve(appPath, 'Contents', 'Resources', 'app'));
        });

        const outAppPath = path.resolve(appsOutPath, 'ShimNoAsar.app');
        await makeUniversalApp({
          x64AppPath,
          arm64AppPath,
          outAppPath,
        });
        await verifyApp(outAppPath);
      },
      VERIFY_APP_TIMEOUT,
    );
  });

  // TODO: Add tests for
  // * different app dirs with different macho files
  // * identical app dirs with universal macho files
});
