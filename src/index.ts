import { spawn } from '@malept/cross-spawn-promise';
import * as asar from 'asar';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

const MACHO_PREFIX = 'Mach-O ';
const macho = require('macho');

const machoParse = async (
  p: string,
): Promise<{
  bits: number;
  cpu: {
    type: 'x86_64' | 'arm64';
    subtype: string;
  };
}> => {
  return macho.parse(await fs.readFile(p));
};

type MakeUniversalOpts = {
  /**
   * Absolute file system path to the x64 version of your application.  E.g. /Foo/bar/MyApp_x64.app
   */
  x64AppPath: string;
  /**
   * Absolute file system path to the arm64 version of your application.  E.g. /Foo/bar/MyApp_arm64.app
   */
  arm64AppPath: string;
  /**
   * Absolute file system path you want the universal app to be written to.  E.g. /Foo/var/MyApp_universal.app
   *
   * If this file exists it will be overwritten ONLY if "force" is set to true
   */
  outAppPath: string;
  /**
   * Forcefully overwrite any existing files that are in the way of generating the universal application
   */
  force: boolean;
};

enum AsarMode {
  NO_ASAR,
  PURE_ASAR_EMBEDDED_NATIVE_MODULES,
  PURE_ASAR_UNPACKED_NATIVE_MODULES,
}

const detectAsarMode = async (appPath: string) => {
  const asarPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar');
  const asarUnpackedPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar.unpacked');

  if (!(await fs.pathExists(asarPath))) return AsarMode.NO_ASAR;
  const nativeContents = asar.listPackage(asarPath).filter((p) => p.endsWith('.node'));
  for (const nativeModule of nativeContents) {
    if (!(await fs.pathExists(path.resolve(asarUnpackedPath, nativeModule.substr(1)))))
      return AsarMode.PURE_ASAR_EMBEDDED_NATIVE_MODULES;
  }
  return AsarMode.PURE_ASAR_UNPACKED_NATIVE_MODULES;
};

const getAllMachOFiles = async (appPath: string) => {
  const machoOFiles: string[] = [];

  const visited = new Set<string>();
  const traverse = async (p: string) => {
    p = await fs.realpath(p);
    if (visited.has(p)) return;
    visited.add(p);

    const info = await fs.stat(p);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      const fileOutput = await spawn('file', ['--brief', '--no-pad', p]);
      if (fileOutput.startsWith(MACHO_PREFIX)) {
        machoOFiles.push(path.relative(appPath, p));
      }
    }

    if (info.isDirectory()) {
      for (const child of await fs.readdir(p)) {
        await traverse(path.resolve(p, child));
      }
    }
  };
  await traverse(appPath);

  return machoOFiles;
};

export const makeUniversalApp = async (opts: MakeUniversalOpts): Promise<void> => {
  if (process.platform !== 'darwin')
    throw new Error('@electron/universal is only supported on darwin platforms');
  if (!opts.x64AppPath || !path.isAbsolute(opts.x64AppPath))
    throw new Error('Expected opts.x64AppPath to be an absolute path but it was not');
  if (!opts.arm64AppPath || !path.isAbsolute(opts.arm64AppPath))
    throw new Error('Expected opts.arm64AppPath to be an absolute path but it was not');
  if (!opts.outAppPath || !path.isAbsolute(opts.outAppPath))
    throw new Error('Expected opts.outAppPath to be an absolute path but it was not');

  if (await fs.pathExists(opts.outAppPath)) {
    if (!opts.force) {
      throw new Error(
        `The out path "${opts.outAppPath}" already exists and force is not set to true`,
      );
    } else {
      await fs.remove(opts.outAppPath);
    }
  }

  const x64AsarMode = await detectAsarMode(opts.x64AppPath);
  const arm64AsarMode = await detectAsarMode(opts.arm64AppPath);

  if (x64AsarMode !== arm64AsarMode)
    throw new Error(
      'Both the x64 and arm64 versions of your application need to have been built with the same asar settings (enabled vs disabled)',
    );
  if (x64AsarMode === AsarMode.PURE_ASAR_EMBEDDED_NATIVE_MODULES)
    throw new Error(
      '@electron/universal does not currently support apps that contain native modules in ASAR files.  Please use asar.unpacked',
    );
  if (arm64AsarMode === AsarMode.PURE_ASAR_EMBEDDED_NATIVE_MODULES)
    throw new Error(
      '@electron/universal does not currently support apps that contain native modules in ASAR files.  Please use asar.unpacked',
    );

  const tmpDir = await fs.mkdtemp(path.resolve(os.tmpdir(), 'electron-universal-'));

  try {
    const tmpApp = path.resolve(tmpDir, 'Tmp.app');
    await spawn('cp', ['-R', opts.x64AppPath, tmpApp]);

    const uniqueToX64: string[] = [];
    const uniqueToArm64: string[] = [];
    const x64MachOFiles = await getAllMachOFiles(await fs.realpath(tmpApp));
    const arm64MachoOFiles = await getAllMachOFiles(opts.arm64AppPath);

    for (const file of x64MachOFiles) {
      if (!arm64MachoOFiles.includes(file)) uniqueToX64.push(file);
    }
    for (const file of arm64MachoOFiles) {
      if (!x64MachOFiles.includes(file)) uniqueToArm64.push(file);
    }
    if (uniqueToX64.length !== 0 || uniqueToArm64.length !== 0) {
      console.error({
        uniqueToX64,
        uniqueToArm64,
      });
      throw new Error(
        'While trying to merge mach-o files across your apps we found a mismatch, the number of mach-o files is not the same between the arm64 and x64 builds',
      );
    }

    console.log(x64MachOFiles);
    for (const machOFile of x64MachOFiles) {
      await spawn('lipo', [
        await fs.realpath(path.resolve(tmpApp, machOFile)),
        await fs.realpath(path.resolve(opts.arm64AppPath, machOFile)),
        '-create',
        '-output',
        await fs.realpath(path.resolve(tmpApp, machOFile)),
      ]);
    }

    await spawn('mv', [tmpApp, opts.outAppPath]);
  } catch (err) {
    throw err;
  } finally {
    await fs.remove(tmpDir);
  }
};
