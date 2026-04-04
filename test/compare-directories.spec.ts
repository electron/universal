import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compareDirectories, DiffEntry } from '../src/file-utils.js';

const sortDiff = (entries: DiffEntry[]) =>
  [...entries].sort((a, b) => {
    const pathA = a.relativePath + (a.name1 ?? '');
    const pathB = b.relativePath + (b.name1 ?? '');
    return pathA.localeCompare(pathB);
  });

describe('compareDirectories', () => {
  let tmpDir: string;
  let dir1: string;
  let dir2: string;

  const setup = async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compare-test-'));
    dir1 = path.join(tmpDir, 'dir1');
    dir2 = path.join(tmpDir, 'dir2');
    await fs.promises.mkdir(dir1, { recursive: true });
    await fs.promises.mkdir(dir2, { recursive: true });
  };

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('should report identical directories as all equal', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir1, 'a.txt'), 'hello');
    await fs.promises.writeFile(path.join(dir2, 'a.txt'), 'hello');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([{ state: 'equal', name1: 'a.txt', relativePath: '' }]);
  });

  it('should detect files with different content as distinct', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir1, 'a.txt'), 'hello');
    await fs.promises.writeFile(path.join(dir2, 'a.txt'), 'world');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([{ state: 'distinct', name1: 'a.txt', relativePath: '' }]);
  });

  it('should detect left-only files', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir1, 'only-left.txt'), 'data');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([{ state: 'left', name1: 'only-left.txt', relativePath: '' }]);
  });

  it('should detect right-only files (name1 is undefined)', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir2, 'only-right.txt'), 'data');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([{ state: 'right', relativePath: '' }]);
  });

  it('should handle nested directories', async () => {
    await setup();
    await fs.promises.mkdir(path.join(dir1, 'sub'), { recursive: true });
    await fs.promises.mkdir(path.join(dir2, 'sub'), { recursive: true });
    await fs.promises.writeFile(path.join(dir1, 'sub', 'nested.txt'), 'same');
    await fs.promises.writeFile(path.join(dir2, 'sub', 'nested.txt'), 'same');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([{ state: 'equal', name1: 'nested.txt', relativePath: 'sub' }]);
  });

  it('should handle deeply nested files with correct relativePath', async () => {
    await setup();
    await fs.promises.mkdir(path.join(dir1, 'a', 'b'), { recursive: true });
    await fs.promises.mkdir(path.join(dir2, 'a', 'b'), { recursive: true });
    await fs.promises.writeFile(path.join(dir1, 'a', 'b', 'deep.txt'), 'x');
    await fs.promises.writeFile(path.join(dir2, 'a', 'b', 'deep.txt'), 'y');

    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([
      { state: 'distinct', name1: 'deep.txt', relativePath: path.join('a', 'b') },
    ]);
  });

  it('should handle empty directories', async () => {
    await setup();
    const results = await compareDirectories(dir1, dir2);
    expect(results).toEqual([]);
  });

  it('should handle mixed states across multiple files', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir1, 'same.txt'), 'same');
    await fs.promises.writeFile(path.join(dir2, 'same.txt'), 'same');
    await fs.promises.writeFile(path.join(dir1, 'diff.txt'), 'v1');
    await fs.promises.writeFile(path.join(dir2, 'diff.txt'), 'v2');
    await fs.promises.writeFile(path.join(dir1, 'left-only.txt'), 'left');
    await fs.promises.writeFile(path.join(dir2, 'right-only.txt'), 'right');

    const results = sortDiff(await compareDirectories(dir1, dir2));
    expect(results).toEqual(
      sortDiff([
        { state: 'equal', name1: 'same.txt', relativePath: '' },
        { state: 'distinct', name1: 'diff.txt', relativePath: '' },
        { state: 'left', name1: 'left-only.txt', relativePath: '' },
        { state: 'right', relativePath: '' },
      ]),
    );
  });

  it('should follow symlinks and compare target content', async () => {
    await setup();
    await fs.promises.writeFile(path.join(dir1, 'real.txt'), 'content');
    await fs.promises.symlink(path.join(dir1, 'real.txt'), path.join(dir1, 'link.txt'));
    await fs.promises.writeFile(path.join(dir2, 'link.txt'), 'content');

    const results = sortDiff(await compareDirectories(dir1, dir2));
    const linkEntry = results.find((r) => r.name1 === 'link.txt');
    expect(linkEntry?.state).toBe('equal');
  });

  it('should traverse symlinked directories', async () => {
    await setup();
    // dir1: realdir/file.txt + linkdir -> realdir
    await fs.promises.mkdir(path.join(dir1, 'realdir'));
    await fs.promises.writeFile(path.join(dir1, 'realdir', 'file.txt'), 'data');
    await fs.promises.symlink(path.join(dir1, 'realdir'), path.join(dir1, 'linkdir'));
    // dir2: same structure
    await fs.promises.mkdir(path.join(dir2, 'realdir'));
    await fs.promises.writeFile(path.join(dir2, 'realdir', 'file.txt'), 'data');
    await fs.promises.symlink(path.join(dir2, 'realdir'), path.join(dir2, 'linkdir'));

    const results = await compareDirectories(dir1, dir2);
    const linkdirEntry = results.find((r) => r.relativePath === 'linkdir');
    expect(linkdirEntry).toBeDefined();
    expect(linkdirEntry!.state).toBe('equal');
    expect(linkdirEntry!.name1).toBe('file.txt');
  });
});
