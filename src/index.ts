import { spawn } from '@malept/cross-spawn-promise';
import * as asar from '@electron/asar';
import * as fs from 'fs-extra';
import { minimatch } from 'minimatch';
import * as os from 'os';
import * as path from 'path';
import * as plist from 'plist';
import * as dircompare from 'dir-compare';

import { AppFile, AppFileType, getAllAppFiles } from './file-utils';
import { AsarMode, detectAsarMode, generateAsarIntegrity, mergeASARs } from './asar-utils';
import { sha } from './sha';
import { d } from './debug';

/**
 * Options to pass into the {@link makeUniversalApp} function.
 *
 * Requires absolute paths for input x64 and arm64 apps and an absolute path to the
 * output universal app.
 */
export type MakeUniversalOpts = {
  /**
   * Absolute file system path to the x64 version of your application (e.g. `/Foo/bar/MyApp_x64.app`).
   */
  x64AppPath: string;
  /**
   * Absolute file system path to the arm64 version of your application (e.g. `/Foo/bar/MyApp_arm64.app`).
   */
  arm64AppPath: string;
  /**
   * Absolute file system path you want the universal app to be written to (e.g. `/Foo/var/MyApp_universal.app`).
   *
   * If this file exists on disk already, it will be overwritten ONLY if {@link MakeUniversalOpts.force} is set to `true`.
   */
  outAppPath: string;
  /**
   * Forcefully overwrite any existing files that are in the way of generating the universal application.
   *
   * @defaultValue `false`
   */
  force?: boolean;
  /**
   * Merge x64 and arm64 ASARs into one.
   *
   * @defaultValue `false`
   */
  mergeASARs?: boolean;
  /**
   * If {@link MakeUniversalOpts.mergeASARs} is enabled, this property provides a
   * {@link https://github.com/isaacs/minimatch?tab=readme-ov-file#features | minimatch}
   * pattern of paths that are allowed to be present in one of the ASAR files, but not in the other.
   *
   */
  singleArchFiles?: string;
  /**
   * A {@link https://github.com/isaacs/minimatch?tab=readme-ov-file#features | minimatch}
   * pattern of binaries that are expected to be the same x64 binary in both of the application files.
   *
   * Use this if your application contains binaries that have already been merged into a universal file
   * using the `lipo` tool.
   *
   * @see Apple's {@link https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary | Building a universal macOS binary} documentation
   */
  x64ArchFiles?: string;
  /**
   * A {@link https://github.com/isaacs/minimatch?tab=readme-ov-file#features | minimatch} pattern of `Info.plist`
   * paths that should not receive an injected `ElectronAsarIntegrity` value.
   *
   * Use this if your application contains another bundle that's already signed.
   */
  infoPlistsToIgnore?: string;
};

const dupedFiles = (files: AppFile[]) =>
  files.filter((f) => f.type !== AppFileType.SNAPSHOT && f.type !== AppFileType.APP_CODE);

export const makeUniversalApp = async (opts: MakeUniversalOpts): Promise<void> => {
  d('making a universal app with options', opts);

  if (process.platform !== 'darwin')
    throw new Error('@electron/universal is only supported on darwin platforms');
  if (!opts.x64AppPath || !path.isAbsolute(opts.x64AppPath))
    throw new Error('Expected opts.x64AppPath to be an absolute path but it was not');
  if (!opts.arm64AppPath || !path.isAbsolute(opts.arm64AppPath))
    throw new Error('Expected opts.arm64AppPath to be an absolute path but it was not');
  if (!opts.outAppPath || !path.isAbsolute(opts.outAppPath))
    throw new Error('Expected opts.outAppPath to be an absolute path but it was not');

  if (await fs.pathExists(opts.outAppPath)) {
    d('output path exists already');
    if (!opts.force) {
      throw new Error(
        `The out path "${opts.outAppPath}" already exists and force is not set to true`,
      );
    } else {
      d('overwriting existing application because force == true');
      await fs.remove(opts.outAppPath);
    }
  }

  const x64AsarMode = await detectAsarMode(opts.x64AppPath);
  const arm64AsarMode = await detectAsarMode(opts.arm64AppPath);
  d('detected x64AsarMode =', x64AsarMode);
  d('detected arm64AsarMode =', arm64AsarMode);

  if (x64AsarMode !== arm64AsarMode)
    throw new Error(
      'Both the x64 and arm64 versions of your application need to have been built with the same asar settings (enabled vs disabled)',
    );

  const tmpDir = await fs.mkdtemp(path.resolve(os.tmpdir(), 'electron-universal-'));
  d('building universal app in', tmpDir);

  try {
    d('copying x64 app as starter template');
    const tmpApp = path.resolve(tmpDir, 'Tmp.app');
    await spawn('cp', ['-R', opts.x64AppPath, tmpApp]);

    const uniqueToX64: string[] = [];
    const uniqueToArm64: string[] = [];
    const x64Files = await getAllAppFiles(await fs.realpath(tmpApp));
    const arm64Files = await getAllAppFiles(await fs.realpath(opts.arm64AppPath));

    for (const file of dupedFiles(x64Files)) {
      if (!arm64Files.some((f) => f.relativePath === file.relativePath))
        uniqueToX64.push(file.relativePath);
    }
    for (const file of dupedFiles(arm64Files)) {
      if (!x64Files.some((f) => f.relativePath === file.relativePath))
        uniqueToArm64.push(file.relativePath);
    }
    if (uniqueToX64.length !== 0 || uniqueToArm64.length !== 0) {
      d('some files were not in both builds, aborting');
      console.error({
        uniqueToX64,
        uniqueToArm64,
      });
      throw new Error(
        'While trying to merge mach-o files across your apps we found a mismatch, the number of mach-o files is not the same between the arm64 and x64 builds',
      );
    }

    for (const file of x64Files.filter((f) => f.type === AppFileType.PLAIN)) {
      const x64Sha = await sha(path.resolve(opts.x64AppPath, file.relativePath));
      const arm64Sha = await sha(path.resolve(opts.arm64AppPath, file.relativePath));
      if (x64Sha !== arm64Sha) {
        d('SHA for file', file.relativePath, `does not match across builds ${x64Sha}!=${arm64Sha}`);
        // The MainMenu.nib files generated by Xcode13 are deterministic in effect but not deterministic in generated sequence
        if (path.basename(path.dirname(file.relativePath)) === 'MainMenu.nib') {
          // The mismatch here is OK so we just move on to the next one
          continue;
        }
        throw new Error(
          `Expected all non-binary files to have identical SHAs when creating a universal build but "${file.relativePath}" did not`,
        );
      }
    }
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

    /**
     * If we don't have an ASAR we need to check if the two "app" folders are identical, if
     * they are then we can just leave one there and call it a day.  If the app folders for x64
     * and arm64 are different though we need to rename each folder and create a new fake "app"
     * entrypoint to dynamically load the correct app folder
     */
    if (x64AsarMode === AsarMode.NO_ASAR) {
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

      if (nonMergedDifferences.length > 0) {
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
        await asar.createPackage(
          entryAsar,
          path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'),
        );
      } else {
        d('x64 and arm64 app folders are the same');
      }
    }

    const generatedIntegrity: Record<string, { algorithm: 'SHA256'; hash: string }> = {};

    /**
     * If we have an ASAR we just need to check if the two "app.asar" files have the same hash,
     * if they are, same as above, we can leave one there and call it a day.  If they're different
     * we have to make a dynamic entrypoint.  There is an assumption made here that every file in
     * app.asar.unpacked is a native node module.  This assumption _may_ not be true so we should
     * look at codifying that assumption as actual logic.
     */
    // FIXME: Codify the assumption that app.asar.unpacked only contains native modules
    if (x64AsarMode === AsarMode.HAS_ASAR) {
      d('checking if the x64 and arm64 asars are identical');
      const x64AsarSha = await sha(path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'));
      const arm64AsarSha = await sha(
        path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app.asar'),
      );

      if (x64AsarSha !== arm64AsarSha) {
        d('x64 and arm64 asars are different');
        if (opts.mergeASARs) {
          d('merging x64 and arm64 asars');
          const output = path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar');
          await mergeASARs({
            x64AsarPath: path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'),
            arm64AsarPath: path.resolve(opts.arm64AppPath, 'Contents', 'Resources', 'app.asar'),
            outputAsarPath: output,
            singleArchFiles: opts.singleArchFiles,
          });

          generatedIntegrity['Resources/app.asar'] = generateAsarIntegrity(output);
        } else {
          d('splitting x64 and arm64 asars');
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
        }
      } else {
        d('x64 and arm64 asars are the same');
        generatedIntegrity['Resources/app.asar'] = generateAsarIntegrity(
          path.resolve(tmpApp, 'Contents', 'Resources', 'app.asar'),
        );
      }
    }

    const plistFiles = x64Files.filter((f) => f.type === AppFileType.INFO_PLIST);
    for (const plistFile of plistFiles) {
      const x64PlistPath = path.resolve(opts.x64AppPath, plistFile.relativePath);
      const arm64PlistPath = path.resolve(opts.arm64AppPath, plistFile.relativePath);

      const { ElectronAsarIntegrity: x64Integrity, ...x64Plist } = plist.parse(
        await fs.readFile(x64PlistPath, 'utf8'),
      ) as any;
      const { ElectronAsarIntegrity: arm64Integrity, ...arm64Plist } = plist.parse(
        await fs.readFile(arm64PlistPath, 'utf8'),
      ) as any;
      if (JSON.stringify(x64Plist) !== JSON.stringify(arm64Plist)) {
        throw new Error(
          `Expected all Info.plist files to be identical when ignoring integrity when creating a universal build but "${plistFile.relativePath}" was not`,
        );
      }

      const injectAsarIntegrity =
        !opts.infoPlistsToIgnore ||
        minimatch(plistFile.relativePath, opts.infoPlistsToIgnore, { matchBase: true });
      const mergedPlist = injectAsarIntegrity
        ? { ...x64Plist, ElectronAsarIntegrity: generatedIntegrity }
        : { ...x64Plist };

      await fs.writeFile(path.resolve(tmpApp, plistFile.relativePath), plist.build(mergedPlist));
    }

    for (const snapshotsFile of arm64Files.filter((f) => f.type === AppFileType.SNAPSHOT)) {
      d('copying snapshot file', snapshotsFile.relativePath, 'to target application');
      await fs.copy(
        path.resolve(opts.arm64AppPath, snapshotsFile.relativePath),
        path.resolve(tmpApp, snapshotsFile.relativePath),
      );
    }

    d('moving final universal app to target destination');
    await fs.mkdirp(path.dirname(opts.outAppPath));
    await spawn('mv', [tmpApp, opts.outAppPath]);
  } catch (err) {
    throw err;
  } finally {
    await fs.remove(tmpDir);
  }
};
