import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createPackageWithOptions, getRawHeader } from '@electron/asar';
import { downloadArtifact } from '@electron/get';
import * as zip from 'cross-zip';
import plist from 'plist';
import type { ExpectStatic } from 'vitest';

const execFile = promisify(execFileCb);

import * as fileUtils from '../dist/file-utils.js';

// We do a LOT of verifications in `verifyApp` 😅
// exec universal binary -> verify ALL asars -> verify ALL app dirs -> verify ALL asar integrity entries
// plus some tests create fixtures at runtime
export const VERIFY_APP_TIMEOUT = 80 * 1000;

export const fixtureDir = path.resolve(import.meta.dirname, 'fixtures');
export const asarsDir = path.resolve(fixtureDir, 'asars');
export const appsDir = path.resolve(fixtureDir, 'apps');

export const verifyApp = async (
  expect: ExpectStatic,
  appPath: string,
  containsRuntimeGeneratedMacho = false,
) => {
  await ensureUniversal(expect, appPath);

  const resourcesDir = path.resolve(appPath, 'Contents', 'Resources');
  const resourcesDirContents = await fs.promises.readdir(resourcesDir);

  // sort for consistent result
  const asars = resourcesDirContents.filter((p) => p.endsWith('.asar')).sort();
  for await (const asar of asars) {
    // verify header
    const asarFs = getRawHeader(path.resolve(resourcesDir, asar));
    expect(
      removeUnstableProperties(
        asarFs.header,
        containsRuntimeGeneratedMacho
          ? ['hello-world', 'hello-world-arm64', 'hello-world-x64']
          : [],
      ),
    ).toMatchSnapshot();
  }

  // check all app and unpacked dirs (incl. shimmed)
  const dirsToSnapshot = [
    'app',
    'app.asar.unpacked',
    'app-x64',
    'app-x64.asar.unpacked',
    'app-arm64',
    'app-arm64.asar.unpacked',
  ];
  const appDirs = resourcesDirContents
    .filter((p) => dirsToSnapshot.includes(path.basename(p)))
    .sort();
  for await (const dir of appDirs) {
    await verifyFileTree(expect, path.resolve(resourcesDir, dir));
  }

  const allFiles = await fileUtils.getAllAppFiles(appPath, {});
  const infoPlists = allFiles
    .filter(
      (appFile) =>
        appFile.type === fileUtils.AppFileType.INFO_PLIST &&
        // These are test app fixtures, no need to snapshot within `TestApp.app/Contents/Frameworks`
        !appFile.relativePath.includes(path.join('Contents', 'Frameworks')),
    )
    .map((af) => af.relativePath)
    .sort();

  const integrityMap: Record<string, string> = {};
  const integrity = await Promise.all(
    infoPlists.map((ip) => extractAsarIntegrity(path.resolve(appPath, ip))),
  );
  for (let i = 0; i < integrity.length; i++) {
    const relativePath = infoPlists[i];
    const asarIntegrity = integrity[i];
    // note: `infoPlistsToIgnore` will not have integrity in sub-app plists
    integrityMap[relativePath] = asarIntegrity
      ? removeUnstableProperties(asarIntegrity, containsRuntimeGeneratedMacho ? ['hash'] : [])
      : undefined;
  }
  expect(integrityMap).toMatchSnapshot();
};

const extractAsarIntegrity = async (infoPlist: string) => {
  const { ElectronAsarIntegrity: integrity, ...otherData } = plist.parse(
    await fs.promises.readFile(infoPlist, 'utf-8'),
  ) as any;
  return integrity;
};

export const verifyFileTree = async (expect: ExpectStatic, dirPath: string) => {
  const dirFiles = await fileUtils.getAllAppFiles(dirPath, {});
  const files = dirFiles.map((file) => {
    const it = path.join(dirPath, file.relativePath);
    const name = toSystemIndependentPath(file.relativePath);
    if (it.endsWith('.txt') || it.endsWith('.json')) {
      return { name, content: fs.readFileSync(it, 'utf-8') };
    }
    return name;
  });
  expect(files).toMatchSnapshot();
};

export const ensureUniversal = async (expect: ExpectStatic, app: string) => {
  const exe = path.resolve(app, 'Contents', 'MacOS', 'Electron');
  const { stdout: result } = await execFile(exe);
  expect(result).toContain('arm64');
  const { stdout: result2 } = await execFile('arch', ['-x86_64', exe]);
  expect(result2).toContain('x64');
};

export const toSystemIndependentPath = (s: string): string => {
  return path.sep === '/' ? s : s.replace(/\\/g, '/');
};

export const removeUnstableProperties = (data: any, stripKeys: string[]) => {
  const removeKeysRecursively: (obj: any, keysToRemove: string[]) => any = (obj, keysToRemove) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    // if the value is an array, map over it
    if (Array.isArray(obj)) {
      return obj.map((item: any) => removeKeysRecursively(item, keysToRemove));
    }
    return Object.keys(obj).reduce<any>((acc, key) => {
      // if the value of the current key is another object, make a recursive call to remove the key from the nested object
      if (!keysToRemove.includes(key)) {
        acc[key] = removeKeysRecursively(obj[key], keysToRemove);
      } else {
        acc[key] = '<stripped>';
      }
      return acc;
    }, {});
  };

  const filteredData = removeKeysRecursively(data, stripKeys);
  return JSON.parse(
    JSON.stringify(filteredData, (name, value) => {
      if (name === 'offset') {
        return undefined;
      }
      return value;
    }),
  );
};

/**
 * Creates an app directory at runtime for usage:
 * - `testPath` can be used with `asar.createPackage`. Just set the output `.asar` path to `Test.app/Contents/Resources/<asar_name>.asar`
 * - `testPath` can be utilized for logic paths involving `AsarMode.NO_ASAR` and copied directly to `Test.app/Contents/Resources`
 *
 * Directory structure:
 * testName
 * ├── private
 * │   └── var
 * │       ├── app
 * │       │   └── file.txt -> ../file.txt
 * │       └── file.txt
 * └── var -> private/var
 * ├── index.js
 * ├── package.json
 */
export const createStagingAppDir = async (
  testName: string | undefined,
  additionalFiles: Record<string, string> = {},
) => {
  const testPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${testName || 'app'}-`));
  await fs.promises.cp(path.join(asarsDir, 'app'), testPath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  const privateVarPath = path.join(testPath, 'private', 'var');
  const varPath = path.join(testPath, 'var');

  await fs.promises.mkdir(privateVarPath, { recursive: true });
  await fs.promises.symlink(path.relative(testPath, privateVarPath), varPath);

  const files = {
    'file.txt': 'hello world',
    ...additionalFiles,
  };
  for await (const [filename, fileData] of Object.entries(files)) {
    const originFilePath = path.join(varPath, filename);
    await fs.promises.writeFile(originFilePath, fileData);
  }
  const appPath = path.join(varPath, 'app');
  await fs.promises.mkdir(appPath, { recursive: true });
  await fs.promises.symlink('../file.txt', path.join(appPath, 'file.txt'));

  return {
    testPath,
    varPath,
    appPath,
  };
};

export const downloadElectronZip = (arch: string) =>
  downloadArtifact({
    artifactName: 'electron',
    version: '27.0.0',
    platform: 'darwin',
    arch,
  });

export const templateApp = async (
  name: string,
  arch: string,
  modify: (appPath: string) => Promise<void>,
) => {
  const electronZip = await downloadElectronZip(arch);
  // unzip to a unique tmpdir so concurrent calls don't race on the intermediate
  // Electron.app path
  const extractDir = await fs.promises.mkdtemp(path.join(appsDir, '.extract-'));
  const appPath = path.resolve(appsDir, name);
  zip.unzipSync(electronZip, extractDir);
  await fs.promises.rename(path.resolve(extractDir, 'Electron.app'), appPath);
  await fs.promises.rm(extractDir, { recursive: true, force: true });
  await fs.promises.rm(path.resolve(appPath, 'Contents', 'Resources', 'default_app.asar'), {
    recursive: true,
    force: true,
  });
  await modify(appPath);

  return appPath;
};

export const generateNativeApp = async (options: {
  appNameWithExtension: string;
  arch: string;
  createAsar: boolean;
  nativeModuleArch?: string;
  additionalFiles?: Record<string, string>;
  singleArchBindings?: boolean;
}) => {
  const {
    appNameWithExtension,
    arch,
    createAsar,
    nativeModuleArch = arch,
    additionalFiles,
    singleArchBindings,
  } = options;
  const appPath = await templateApp(appNameWithExtension, arch, async (appPath) => {
    const resources = path.join(appPath, 'Contents', 'Resources');
    const resourcesApp = path.resolve(resources, 'app');
    if (!fs.existsSync(resourcesApp)) {
      await fs.promises.mkdir(resourcesApp, { recursive: true });
    }
    const { testPath } = await createStagingAppDir(
      path.basename(appNameWithExtension, '.app'),
      additionalFiles,
    );
    let targetBinding: string;
    if (singleArchBindings) {
      targetBinding = path.join(testPath, `hello-world-${nativeModuleArch}`);
    } else {
      targetBinding = path.join(testPath, 'hello-world');
    }
    await fs.promises.cp(path.join(appsDir, `hello-world-${nativeModuleArch}`), targetBinding, {
      recursive: true,
      verbatimSymlinks: true,
    });
    if (createAsar) {
      await createPackageWithOptions(testPath, path.resolve(resources, 'app.asar'), {
        unpack: '**/hello-world*',
      });
    } else {
      await fs.promises.cp(testPath, resourcesApp, { recursive: true, verbatimSymlinks: true });
    }
  });
  return appPath;
};
