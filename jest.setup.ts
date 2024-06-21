import { downloadArtifact } from '@electron/get';
import * as zip from 'cross-zip';
import * as fs from 'fs-extra';
import * as path from 'path';

const asarsDir = path.resolve(__dirname, 'test', 'fixtures', 'asars');
const appsDir = path.resolve(__dirname, 'test', 'fixtures', 'apps');

const templateApp = async (
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
};

export default async () => {
  await fs.remove(appsDir);
  await fs.mkdirp(appsDir);
  await templateApp('Arm64Asar.app', 'arm64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app.asar'),
      path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
    );
  });

  // contains `extra-file.txt`
  await templateApp('Arm64AsarExtraFile.app', 'arm64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app2.asar'),
      path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
    );
  });

  await templateApp('X64Asar.app', 'x64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app.asar'),
      path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
    );
  });

  await templateApp('Arm64NoAsar.app', 'arm64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app'),
      path.resolve(appPath, 'Contents', 'Resources', 'app'),
    );
  });

  // contains `extra-file.txt`
  await templateApp('Arm64NoAsarExtraFile.app', 'arm64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app2'),
      path.resolve(appPath, 'Contents', 'Resources', 'app'),
    );
  });

  await templateApp('X64NoAsar.app', 'x64', async (appPath) => {
    await fs.copy(
      path.resolve(asarsDir, 'app'),
      path.resolve(appPath, 'Contents', 'Resources', 'app'),
    );
  });
};
