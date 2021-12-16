import * as asar from 'asar';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as minimatch from 'minimatch';
import * as os from 'os';
import { d } from './debug';

export enum AsarMode {
  NO_ASAR,
  HAS_ASAR,
}

export type FuseASARsOptions = {
  x64: string;
  arm64: string;
  output: string;

  lipo?: string;
  uniqueAllowList?: string;
};

// See: https://github.com/apple-opensource-mirror/llvmCore/blob/0c60489d96c87140db9a6a14c6e82b15f5e5d252/include/llvm/Object/MachOFormat.h#L108-L112
const MACHO_MAGIC = new Set([
  // 32-bit Mach-O
  0xfeedface,
  0xcefaedfe,

  // 64-bit Mach-O
  0xfeedfacf,
  0xcffaedfe,

  // Universal
  0xcafebabe,
  0xbebafeca,
]);

export const detectAsarMode = async (appPath: string) => {
  d('checking asar mode of', appPath);
  const asarPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar');

  if (!(await fs.pathExists(asarPath))) {
    d('determined no asar');
    return AsarMode.NO_ASAR;
  }

  d('determined has asar');
  return AsarMode.HAS_ASAR;
};

export const generateAsarIntegrity = (asarPath: string) => {
  return {
    algorithm: 'SHA256' as const,
    hash: crypto
      .createHash('SHA256')
      .update(asar.getRawHeader(asarPath).headerString)
      .digest('hex'),
  };
};

function toRelativePath(file: string): string {
  return file.replace(/^\//, '');
}

function isDirectory(a: string, file: string): boolean {
  return Boolean('files' in asar.statFile(a, file));
}

function checkUnique(archive: string, file: string, allowList?: string): void {
  if (allowList === undefined || !minimatch(file, allowList, { matchBase: true })) {
    throw new Error(
      `Detected unique file "${file}" in "${archive}" not covered by ` +
        `allowList rule: "${allowList}"`,
    );
  }
}

export const fuseASARs = async ({
  x64,
  arm64,
  output,
  lipo = 'lipo',
  uniqueAllowList,
}: FuseASARsOptions): Promise<void> => {
  d(`fusing ${x64} and ${arm64}`);

  const x64Files = new Set(asar.listPackage(x64).map(toRelativePath));
  const arm64Files = new Set(asar.listPackage(arm64).map(toRelativePath));

  //
  // Build set of unpacked directories and files
  //

  const unpackedFiles = new Set<string>();

  function buildUnpacked(a: string, fileList: Set<string>): void {
    for (const file of fileList) {
      const stat = asar.statFile(a, file);

      if (!('unpacked' in stat) || !stat.unpacked) {
        continue;
      }

      if ('files' in stat) {
        continue;
      }
      unpackedFiles.add(file);
    }
  }

  buildUnpacked(x64, x64Files);
  buildUnpacked(arm64, arm64Files);

  //
  // Build list of files/directories unique to each asar
  //

  for (const file of x64Files) {
    if (!arm64Files.has(file)) {
      checkUnique(x64, file, uniqueAllowList);
    }
  }
  const arm64Unique = [];
  for (const file of arm64Files) {
    if (!x64Files.has(file)) {
      checkUnique(arm64, file, uniqueAllowList);
      arm64Unique.push(file);
    }
  }

  //
  // Find common bindings with different content
  //

  const commonBindings = [];
  for (const file of x64Files) {
    if (!arm64Files.has(file)) {
      continue;
    }

    // Skip directories
    if (isDirectory(x64, file)) {
      continue;
    }

    const x64Content = asar.extractFile(x64, file);
    const arm64Content = asar.extractFile(arm64, file);

    if (x64Content.compare(arm64Content) === 0) {
      continue;
    }

    if (!MACHO_MAGIC.has(x64Content.readUInt32LE(0))) {
      throw new Error(`Can't reconcile two non-macho files ${file}`);
    }

    commonBindings.push(file);
  }

  //
  // Extract both
  //

  const x64Dir = await fs.mkdtemp(path.join(os.tmpdir(), 'x64-'));
  const arm64Dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arm64-'));

  try {
    d(`extracting ${x64} to ${x64Dir}`);
    asar.extractAll(x64, x64Dir);

    d(`extracting ${arm64} to ${arm64Dir}`);
    asar.extractAll(arm64, arm64Dir);

    for (const file of arm64Unique) {
      const source = path.resolve(arm64Dir, file);
      const destination = path.resolve(x64Dir, file);

      if (isDirectory(arm64, file)) {
        d(`creating unique directory: ${file}`);
        await fs.mkdirp(destination);
        continue;
      }

      d(`xopying unique file: ${file}`);
      await fs.mkdirp(path.dirname(destination));
      await fs.copy(source, destination);
    }

    for (const binding of commonBindings) {
      const source = await fs.realpath(path.resolve(arm64Dir, binding));
      const destination = await fs.realpath(path.resolve(x64Dir, binding));

      d(`fusing binding: ${binding}`);
      execFileSync(lipo, [source, destination, '-create', '-output', destination]);
    }

    d(`creating archive at ${output}`);

    const resolvedUnpack = Array.from(unpackedFiles).map((file) => path.join(x64Dir, file));

    await asar.createPackageWithOptions(x64Dir, output, {
      unpack: `{${resolvedUnpack.join(',')}}`,
    });

    d('done fusing');
  } finally {
    await Promise.all([fs.remove(x64Dir), fs.remove(arm64Dir)]);
  }
};
