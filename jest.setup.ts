import { execFileSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { appsDir, asarsDir, fixtureDir, templateApp } from './test/util';

// generates binaries from hello-world.c
// hello-world-universal, hello-world-x86_64, hello-world-arm64
const generateMachO = () => {
  const src = path.resolve(fixtureDir, 'hello-world.c');

  const outputFiles = ['x86_64', 'arm64'].map((arch) => {
    const machO = path.resolve(appsDir, `hello-world-${arch === 'x86_64' ? 'x64' : arch}`);
    execFileSync('clang', ['-arch', arch, '-o', machO, src]);
    return machO;
  });

  execFileSync('lipo', [
    ...outputFiles,
    '-create',
    '-output',
    path.resolve(appsDir, 'hello-world-universal'),
  ]);
};

export default async () => {
  await fs.remove(appsDir);
  await fs.mkdirp(appsDir);

  // generate mach-o binaries to be leveraged in lipo tests
  generateMachO();

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
