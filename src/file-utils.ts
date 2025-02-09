import * as asar from '@electron/asar';
import { ExitCodeError, spawn } from '@malept/cross-spawn-promise';
import * as dircompare from 'dir-compare';
import * as fs from 'fs-extra';
import { minimatch } from 'minimatch';
import * as path from 'path';
import { MakeUniversalOpts } from '.';
import { generateAsarIntegrity } from './asar-utils';
import { d } from './debug';
import { sha } from './sha';

const MACHO_PREFIX = 'Mach-O ';

export enum AppFileType {
  MACHO,
  PLAIN,
  INFO_PLIST,
  SNAPSHOT,
  APP_CODE,
}

export type AppFile = {
  relativePath: string;
  type: AppFileType;
};

/**
 *
 * @param appPath Path to the application
 */
export const getAllAppFiles = async (appPath: string): Promise<AppFile[]> => {
  const files: AppFile[] = [];

  const visited = new Set<string>();
  const traverse = async (p: string) => {
    p = await fs.realpath(p);
    if (visited.has(p)) return;
    visited.add(p);

    const info = await fs.stat(p);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      let fileType = AppFileType.PLAIN;

      var fileOutput = '';
      try {
        fileOutput = await spawn('file', ['--brief', '--no-pad', p]);
      } catch (e) {
        if (e instanceof ExitCodeError) {
          /* silently accept error codes from "file" */
        } else {
          throw e;
        }
      }
      if (p.includes('app.asar')) {
        fileType = AppFileType.APP_CODE;
      } else if (fileOutput.startsWith(MACHO_PREFIX)) {
        fileType = AppFileType.MACHO;
      } else if (p.endsWith('.bin')) {
        fileType = AppFileType.SNAPSHOT;
      } else if (path.basename(p) === 'Info.plist') {
        fileType = AppFileType.INFO_PLIST;
      }

      files.push({
        relativePath: path.relative(appPath, p),
        type: fileType,
      });
    }

    if (info.isDirectory()) {
      for (const child of await fs.readdir(p)) {
        await traverse(path.resolve(p, child));
      }
    }
  };
  await traverse(appPath);

  return files;
};

export async function mergeAppFiles(
  tmpApp: string,
  opts: MakeUniversalOpts,
  knownMergedMachOFiles: Set<unknown>,
  tmpDir: string,
) {
  d('checking if the x64 and arm64 app folders are identical');
  const comparison = await dircompare.compare(
    path.resolve(tmpApp, 'Contents', 'Resources', 'app'),
    path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app'),
    { compareSize: true, compareContent: true },
  );
  const differences = comparison.diffSet!.filter((difference) => difference.state !== 'equal');
  d(`Found ${differences.length} difference(s) between the x64 and arm64 folders`);
  const nonMergedDifferences = differences.filter(
    (difference) =>
      !difference.name1 ||
      !knownMergedMachOFiles.has(
        path.join('Contents', 'Resources', 'app', difference.relativePath, difference.name1),
      ),
  );
  d(`After discluding MachO files merged with lipo ${nonMergedDifferences.length} remain.`);

  if (nonMergedDifferences.length === 0) {
    d('x64 and arm64 app folders are the same');
    return;
  }

  d('x64 and arm64 app folders are different, creating dynamic entry ASAR');
  await fs.move(
    path.resolve(tmpApp, 'Contents', 'Resources', 'app'),
    path.resolve(tmpApp, 'Contents', 'Resources', 'app-x64'),
  );
  await fs.copy(
    path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app'),
    path.resolve(tmpApp, 'Contents', 'Resources', 'app-arm64'),
  );

  const entryAsar = path.resolve(tmpDir, 'entry-asar');
  await fs.mkdir(entryAsar);
  await fs.copy(
    path.resolve(__dirname, '..', '..', 'entry-asar', 'no-asar.js'),
    path.resolve(entryAsar, 'index.js'),
  );
  let pj = await fs.readJson(
    path.resolve(opts.x64AppPath, 'Contents', 'Resources', 'app', 'package.json'),
  );
  pj.main = 'index.js';
  await fs.writeJson(path.resolve(entryAsar, 'package.json'), pj);
  await asar.createPackage(entryAsar, path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'));
}

export async function lipoMachOFiles(x64Files: AppFile[], tmpApp: string, opts: MakeUniversalOpts) {
  const knownMergedMachOFiles = new Set();
  for (const machOFile of x64Files.filter((f) => f.type === AppFileType.MACHO)) {
    const first = await fs.realpath(path.resolve(tmpApp, machOFile.relativePath));
    const second = await fs.realpath(path.resolve(opts.arm64AppPath, machOFile.relativePath));

    const x64Sha = await sha(path.resolve(opts.x64AppPath, machOFile.relativePath));
    const arm64Sha = await sha(path.resolve(opts.arm64AppPath, machOFile.relativePath));
    if (x64Sha === arm64Sha) {
      if (
        opts.x64ArchFiles === undefined ||
        !minimatch(machOFile.relativePath, opts.x64ArchFiles, { matchBase: true })
      ) {
        throw new Error(
          `Detected file "${machOFile.relativePath}" that's the same in both x64 and arm64 builds and not covered by the ` +
            `x64ArchFiles rule: "${opts.x64ArchFiles}"`,
        );
      }

      d(
        'SHA for Mach-O file',
        machOFile.relativePath,
        `matches across builds ${x64Sha}===${arm64Sha}, skipping lipo`,
      );
      continue;
    }

    d('joining two MachO files with lipo', {
      first,
      second,
    });
    await spawn('lipo', [
      first,
      second,
      '-create',
      '-output',
      await fs.realpath(path.resolve(tmpApp, machOFile.relativePath)),
    ]);
    knownMergedMachOFiles.add(machOFile.relativePath);
  }
  return knownMergedMachOFiles;
}

export async function copySnapshots(
  arm64Files: AppFile[],
  opts: MakeUniversalOpts,
  tmpApp: string,
) {
  for (const snapshotsFile of arm64Files.filter((f) => f.type === AppFileType.SNAPSHOT)) {
    d('copying snapshot file', snapshotsFile.relativePath, 'to target application');
    await fs.copy(
      path.resolve(opts.arm64AppPath, snapshotsFile.relativePath),
      path.resolve(tmpApp, snapshotsFile.relativePath),
    );
  }
}

// returns true if asar is split and shim is added
export async function copyAndShimAsarIfNeeded(
  tmpApp: string,
  opts: MakeUniversalOpts,
  tmpDir: string,
  generatedIntegrity: Record<string, { algorithm: 'SHA256'; hash: string }>,
) {
  d('checking if the x64 and arm64 asars are identical');
  const x64AsarSha = await sha(path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'));
  const arm64AsarSha = await sha(
    path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app.asar'),
  );

  if (x64AsarSha !== arm64AsarSha) {
    d('x64 and arm64 asars are different');
    const x64AsarPath = path.resolve(tmpApp, 'Contents', 'Resources', 'app-x64.asar');
    await fs.move(path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'), x64AsarPath);
    const x64Unpacked = path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar.unpacked');
    if (await fs.pathExists(x64Unpacked)) {
      await fs.move(
        x64Unpacked,
        path.resolve(tmpApp, 'Contents', 'Resources', 'app-x64.asar.unpacked'),
      );
    }

    const arm64AsarPath = path.resolve(tmpApp, 'Contents', 'Resources', 'app-arm64.asar');
    await fs.copy(
      path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app.asar'),
      arm64AsarPath,
    );
    const arm64Unpacked = path.resolve(
      opts.arm64AppPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
    );
    if (await fs.pathExists(arm64Unpacked)) {
      await fs.copy(
        arm64Unpacked,
        path.resolve(tmpApp, 'Contents', 'Resources', 'app-arm64.asar.unpacked'),
      );
    }

    const entryAsar = path.resolve(tmpDir, 'entry-asar');
    await fs.mkdir(entryAsar);
    await fs.copy(
      path.resolve(__dirname, '..', '..', 'entry-asar', 'has-asar.js'),
      path.resolve(entryAsar, 'index.js'),
    );
    let pj = JSON.parse(
      asar
        .extractFile(
          path.resolve(opts.x64AppPath, 'Contents', 'Resources', 'app.asar'),
          'package.json',
        )
        .toString('utf8'),
    );
    pj.main = 'index.js';
    await fs.writeJson(path.resolve(entryAsar, 'package.json'), pj);
    const asarPath = path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar');
    await asar.createPackage(entryAsar, asarPath);

    generatedIntegrity['Resources/app.asar'] = generateAsarIntegrity(asarPath);
    generatedIntegrity['Resources/app-x64.asar'] = generateAsarIntegrity(x64AsarPath);
    generatedIntegrity['Resources/app-arm64.asar'] = generateAsarIntegrity(arm64AsarPath);
    return true;
  }

  d('x64 and arm64 asars are the same');
  generatedIntegrity['Resources/app.asar'] = generateAsarIntegrity(
    path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'),
  );
  return false;
}
