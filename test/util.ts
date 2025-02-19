import { downloadArtifact } from '@electron/get';
import { spawn } from '@malept/cross-spawn-promise';
import * as zip from 'cross-zip';
import * as fs from 'fs-extra';
import * as path from 'path';
import plist from 'plist';
import * as fileUtils from '../dist/cjs/file-utils';
import { createPackage, getRawHeader } from '@electron/asar';

// We do a LOT of verifications in `verifyApp` 😅
// exec universal binary -> verify ALL asars -> verify ALL app dirs -> verify ALL asar integrity entries
// plus some tests create fixtures at runtime
export const VERIFY_APP_TIMEOUT = 80 * 1000;

const fixtureDir = path.resolve(__dirname, 'fixtures');
export const asarsDir = path.resolve(fixtureDir, 'asars');
export const appsDir = path.resolve(fixtureDir, 'apps');
export const appsOutPath = path.resolve(appsDir, 'out');
const nativeModulesPath = path.resolve(fixtureDir, 'native');

export const verifyApp = async (appPath: string) => {
  await ensureUniversal(appPath);

  const resourcesDir = path.resolve(appPath, 'Contents', 'Resources');
  const resourcesDirContents = await fs.readdir(resourcesDir);

  // sort for consistent result
  const asars = resourcesDirContents.filter((p) => p.endsWith('.asar')).sort();
  for await (const asar of asars) {
    // verify header
    const asarFs = getRawHeader(path.resolve(resourcesDir, asar));
    expect(removeUnstableProperties(asarFs.header)).toMatchSnapshot();
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
    await verifyFileTree(path.resolve(resourcesDir, dir));
  }

  const allFiles = await fileUtils.getAllAppFiles(appPath);
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
    integrityMap[relativePath] = asarIntegrity;
  }
  expect(integrityMap).toMatchSnapshot();
};

// note: `infoPlistsToIgnore` will not have integrity in sub-app plists
const extractAsarIntegrity = async (infoPlist: string) => {
  const { ElectronAsarIntegrity: integrity, ...otherData } = plist.parse(
    await fs.readFile(infoPlist, 'utf-8'),
  ) as any;
  return integrity;
};

export const verifyFileTree = async (dirPath: string) => {
  const dirFiles = await fileUtils.getAllAppFiles(dirPath);
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

export const ensureUniversal = async (app: string) => {
  const exe = path.resolve(app, 'Contents', 'MacOS', 'Electron');
  const result = await spawn(exe);
  expect(result).toContain('arm64');
  const result2 = await spawn('arch', ['-x86_64', exe]);
  expect(result2).toContain('x64');
};

export const toSystemIndependentPath = (s: string): string => {
  return path.sep === '/' ? s : s.replace(/\\/g, '/');
};

export const removeUnstableProperties = (data: any) => {
  return JSON.parse(
    JSON.stringify(data, (name, value) => {
      if (name === 'offset') {
        return undefined;
      }
      return value;
    }),
  );
};

/**
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
export const createTestApp = async (
  testName: string | undefined,
  additionalFiles: Record<string, string> = {},
) => {
  const outDir = (testName || 'app') + Math.floor(Math.random() * 100); // tests run in parallel, randomize dir suffix to prevent naming collisions
  const testPath = path.join(appsDir, outDir);
  await fs.remove(testPath);

  await fs.copy(path.join(asarsDir, 'app'), testPath);

  const privateVarPath = path.join(testPath, 'private', 'var');
  const varPath = path.join(testPath, 'var');

  await fs.mkdir(privateVarPath, { recursive: true });
  await fs.symlink(path.relative(testPath, privateVarPath), varPath);

  const files = {
    'file.txt': 'hello world',
    ...additionalFiles,
  };
  for await (const [filename, fileData] of Object.entries(files)) {
    const originFilePath = path.join(varPath, filename);
    await fs.writeFile(originFilePath, fileData);
  }
  const appPath = path.join(varPath, 'app');
  await fs.mkdirp(appPath);
  await fs.symlink('../file.txt', path.join(appPath, 'file.txt'));

  return {
    testPath,
    varPath,
    appPath,
  };
};

export const templateApp = async (
  name: string,
  arch: string,
  modify: (appPath: string) => Promise<void>,
) => {
  const electronZip = await downloadArtifact({
    artifactName: 'electron',
    version: '27.0.0',
    platform: 'darwin',
    arch,
  });
  const appPath = path.resolve(appsDir, name);
  zip.unzipSync(electronZip, appsDir);
  await fs.rename(path.resolve(appsDir, 'Electron.app'), appPath);
  await fs.remove(path.resolve(appPath, 'Contents', 'Resources', 'default_app.asar'));
  await modify(appPath);

  return appPath;
};

export const generateNativeApp = async (
  appNameWithExtension: string,
  arch: string,
  createAsar: boolean,
  nativeModuleArch = arch,
  additionalFiles?: Record<string, string>,
) => {
  const appPath = await templateApp(appNameWithExtension, arch, async (appPath) => {
    const resources = path.join(appPath, 'Contents', 'Resources');
    const resourcesApp = path.resolve(resources, 'app');
    if (!fs.existsSync(resourcesApp)) {
      await fs.mkdir(resourcesApp);
    }
    const { testPath } = await createTestApp(
      path.basename(appNameWithExtension, '.app'),
      additionalFiles,
    );
    if (createAsar) {
      await createPackage(testPath, path.resolve(resources, 'app.asar'));
    } else {
      await fs.copy(testPath, resourcesApp);
    }
    await fs.copy(
      path.join(nativeModulesPath, `node-mac-permissions.${nativeModuleArch}.node`),
      path.join(resourcesApp, 'node-mac-permissions.node'),
    );
  });
  return appPath;
};
