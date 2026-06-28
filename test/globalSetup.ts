import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPackage } from '@electron/asar';

import { appsDir, asarsDir, downloadElectronZip, fixtureDir, templateApp } from './util.js';

// Build an app source directory whose entrypoint is an ES module. The
// `package.json` and `index.mjs` are byte-identical across arches (so
// `makeUniversalApp`'s identical-SHA check for plain files passes); divergence
// is introduced via a uniquely-named `.bin` file.
//
// For the no-asar case the source directory is copied straight into
// `Contents/Resources/app`, which sits in the bundle tree that
// `makeUniversalApp` scans for mach-o parity. A `.bin` file is classified as a
// V8 snapshot (SNAPSHOT) and so is excluded from that parity check, exactly the
// way the existing non-ESM no-asar shim fixtures diverge (see the
// `should shim two different app folders` test, which uses `hello-world.bin` /
// `i-aint-got-no-rhythm.bin`). A loose plain file (e.g. a `.txt`) would instead
// be treated as a unique PLAIN file and trip the parity guard, so we avoid it.
const createEsmAppDir = async (name: string, extraFile?: string) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'app', type: 'module', main: 'index.mjs' }) + '\n',
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(dir, 'index.mjs'),
    `console.log('I am an ESM app', process.arch);\nprocess.exit(0);\n`,
    'utf8',
  );
  if (extraFile) {
    await fs.promises.writeFile(path.join(dir, extraFile), 'extra\n', 'utf8');
  }
  return dir;
};

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
  await fs.promises.rm(appsDir, { recursive: true, force: true });
  await fs.promises.mkdir(appsDir, { recursive: true });

  // generate mach-o binaries to be leveraged in lipo tests
  generateMachO();

  // @electron/get is not safe for concurrent downloads of the same artifact —
  // warm the cache serially before the parallel templateApp calls (here and in
  // the concurrent test suite) so they all hit the cached zip.
  await downloadElectronZip('arm64');
  await downloadElectronZip('x64');

  await Promise.all([
    templateApp('Arm64Asar.app', 'arm64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app.asar'),
        path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),

    // contains `extra-file.txt`
    templateApp('Arm64AsarExtraFile.app', 'arm64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app2.asar'),
        path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),

    templateApp('X64Asar.app', 'x64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app.asar'),
        path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),

    templateApp('Arm64NoAsar.app', 'arm64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app'),
        path.resolve(appPath, 'Contents', 'Resources', 'app'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),

    // contains `extra-file.txt`
    templateApp('Arm64NoAsarExtraFile.app', 'arm64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app2'),
        path.resolve(appPath, 'Contents', 'Resources', 'app'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),

    templateApp('X64NoAsar.app', 'x64', async (appPath) => {
      await fs.promises.cp(
        path.resolve(asarsDir, 'app'),
        path.resolve(appPath, 'Contents', 'Resources', 'app'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),
  ]);

  // ESM entrypoint fixtures (regression coverage for ERR_REQUIRE_ESM when the
  // x64/arm64 asars diverge). The two arches differ so a shim is generated.
  const x64EsmAsarDir = await createEsmAppDir('X64AsarEsm');
  const arm64EsmAsarDir = await createEsmAppDir('Arm64AsarEsmExtraFile', 'extra-file.txt');
  // The no-asar fixtures are copied straight into the bundle tree, so they must
  // diverge via uniquely-named `.bin` files (excluded from the mach-o parity
  // guard as V8 snapshots) rather than a plain file. This mirrors the existing
  // non-ESM `should shim two different app folders` test exactly.
  const x64EsmNoAsarDir = await createEsmAppDir('X64NoAsarEsm', 'hello-world.bin');
  const arm64EsmNoAsarDir = await createEsmAppDir(
    'Arm64NoAsarEsmExtraFile',
    'i-aint-got-no-rhythm.bin',
  );

  await Promise.all([
    templateApp('X64AsarEsm.app', 'x64', async (appPath) => {
      await createPackage(
        x64EsmAsarDir,
        path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
      );
    }),

    templateApp('Arm64AsarEsmExtraFile.app', 'arm64', async (appPath) => {
      await createPackage(
        arm64EsmAsarDir,
        path.resolve(appPath, 'Contents', 'Resources', 'app.asar'),
      );
    }),

    templateApp('X64NoAsarEsm.app', 'x64', async (appPath) => {
      await fs.promises.cp(x64EsmNoAsarDir, path.resolve(appPath, 'Contents', 'Resources', 'app'), {
        recursive: true,
        verbatimSymlinks: true,
      });
    }),

    templateApp('Arm64NoAsarEsmExtraFile.app', 'arm64', async (appPath) => {
      await fs.promises.cp(
        arm64EsmNoAsarDir,
        path.resolve(appPath, 'Contents', 'Resources', 'app'),
        { recursive: true, verbatimSymlinks: true },
      );
    }),
  ]);
};
