import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as asar from '@electron/asar';
import { minimatch } from 'minimatch';

import { d } from './debug.js';

const LIPO = 'lipo';

export enum AsarMode {
  NO_ASAR,
  HAS_ASAR,
}

export type MergeASARsOptions = {
  x64AsarPath: string;
  arm64AsarPath: string;
  outputAsarPath: string;

  singleArchFiles?: string;
};

// See: https://github.com/apple-opensource-mirror/llvmCore/blob/0c60489d96c87140db9a6a14c6e82b15f5e5d252/include/llvm/Object/MachOFormat.h#L108-L112
const MACHO_MAGIC = new Set([
  // 32-bit Mach-O
  0xfeedface, 0xcefaedfe,

  // 64-bit Mach-O
  0xfeedfacf, 0xcffaedfe,
]);

const MACHO_UNIVERSAL_MAGIC = new Set([
  // universal
  0xcafebabe, 0xbebafeca,
]);

export const detectAsarMode = async (appPath: string) => {
  d('checking asar mode of', appPath);
  const asarPath = path.resolve(appPath, 'Contents', 'Resources', 'app.asar');

  if (!fs.existsSync(asarPath)) {
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

function checkSingleArch(archive: string, file: string, allowList?: string): void {
  if (allowList === undefined || !minimatch(file, allowList, { matchBase: true })) {
    throw new Error(
      `Detected unique file "${file}" in "${archive}" not covered by ` +
        `allowList rule: "${allowList}"`,
    );
  }
}

export const mergeASARs = async ({
  x64AsarPath,
  arm64AsarPath,
  outputAsarPath,
  singleArchFiles,
}: MergeASARsOptions): Promise<void> => {
  d(`merging ${x64AsarPath} and ${arm64AsarPath}`);

  const x64Files = new Set(asar.listPackage(x64AsarPath, { isPack: false }).map(toRelativePath));
  const arm64Files = new Set(
    asar.listPackage(arm64AsarPath, { isPack: false }).map(toRelativePath),
  );

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

  buildUnpacked(x64AsarPath, x64Files);
  buildUnpacked(arm64AsarPath, arm64Files);

  //
  // Build list of files/directories unique to each asar
  //

  for (const file of x64Files) {
    if (!arm64Files.has(file)) {
      checkSingleArch(x64AsarPath, file, singleArchFiles);
    }
  }
  const arm64Unique = [];
  for (const file of arm64Files) {
    if (!x64Files.has(file)) {
      checkSingleArch(arm64AsarPath, file, singleArchFiles);
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
    if (isDirectory(x64AsarPath, file)) {
      continue;
    }

    const x64Content = asar.extractFile(x64AsarPath, file);
    const arm64Content = asar.extractFile(arm64AsarPath, file);

    // Skip file if the same content
    if (x64Content.compare(arm64Content) === 0) {
      continue;
    }

    // Skip universal Mach-O files.
    if (isUniversalMachO(x64Content)) {
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

  const x64Dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'x64-'));
  const arm64Dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'arm64-'));

  try {
    d(`extracting ${x64AsarPath} to ${x64Dir}`);
    asar.extractAll(x64AsarPath, x64Dir);

    d(`extracting ${arm64AsarPath} to ${arm64Dir}`);
    asar.extractAll(arm64AsarPath, arm64Dir);

    for (const file of arm64Unique) {
      const source = path.resolve(arm64Dir, file);
      const destination = path.resolve(x64Dir, file);

      if (isDirectory(arm64AsarPath, file)) {
        d(`creating unique directory: ${file}`);
        await fs.promises.mkdir(destination, { recursive: true });
        continue;
      }

      d(`copying unique file: ${file}`);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.cp(source, destination, {
        force: true,
        recursive: true,
        verbatimSymlinks: true,
      });
    }

    for (const binding of commonBindings) {
      const source = await fs.promises.realpath(path.resolve(arm64Dir, binding));
      const destination = await fs.promises.realpath(path.resolve(x64Dir, binding));

      d(`merging binding: ${binding}`);
      execFileSync(LIPO, [source, destination, '-create', '-output', destination]);
    }

    d(`creating archive at ${outputAsarPath}`);

    const resolvedUnpack = Array.from(unpackedFiles).map((file) => path.join(x64Dir, file));

    let unpack: string | undefined;
    if (resolvedUnpack.length > 1) {
      unpack = `{${resolvedUnpack.join(',')}}`;
    } else if (resolvedUnpack.length === 1) {
      unpack = resolvedUnpack[0];
    }

    await asar.createPackageWithOptions(x64Dir, outputAsarPath, {
      unpack,
    });

    d('done merging');
  } finally {
    await Promise.all([
      fs.promises.rm(x64Dir, { recursive: true, force: true }),
      fs.promises.rm(arm64Dir, { recursive: true, force: true }),
    ]);
  }
};

export const isUniversalMachO = (fileContent: Buffer) => {
  return MACHO_UNIVERSAL_MAGIC.has(fileContent.readUInt32LE(0));
};
