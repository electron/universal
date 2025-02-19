import * as fs from 'fs-extra';
import * as path from 'path';
import { appsDir, asarsDir, templateApp } from './test/util';

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
