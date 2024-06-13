import { spawn } from '@malept/cross-spawn-promise';
import * as fs from 'fs-extra';
import * as path from 'path';

import { makeUniversalApp } from '../src/index';

const appsPath = path.resolve(__dirname, 'fixtures', 'apps');

async function ensureUniversal(app: string) {
  const exe = path.resolve(app, 'Contents', 'MacOS', 'Electron');
  const result = await spawn(exe);
  expect(result).toContain('arm64');
  const result2 = await spawn('arch', ['-x86_64', exe]);
  expect(result2).toContain('x64');
}

describe('makeUniversalApp', () => {
  it.todo('`force` works');
  it.todo('works for lipo binary resources');

  describe('asar mode', () => {
    it('should correctly merge two identical asars', async () => {
      const out = path.resolve(appsPath, 'MergedAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Asar.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
      // Only a single asar as they were identical
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) =>
          p.endsWith('asar'),
        ),
      ).toEqual(['app.asar']);
    }, 60000);
    it('should create two separate non-identical ASAR files', async () => {
      const out = path.resolve(appsPath, 'TwoAsars.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64Asar.app'),
        arm64AppPath: path.resolve(appsPath, 'Asar.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
    }, 60000);
    it.todo('should correctly merge two non-identical asars when `mergeASARs` is enabled');
    it.todo('should not inject ElectronAsarIntegrity into `infoPlistsToIgnore`');
  });

  describe('no asar mode', () => {
    it('should correctly merge two identical app folders', async () => {
      const out = path.resolve(appsPath, 'MergedNoAsar.app');
      await makeUniversalApp({
        x64AppPath: path.resolve(appsPath, 'X64NoAsar.app'),
        arm64AppPath: path.resolve(appsPath, 'NoAsar.app'),
        outAppPath: out,
      });
      await ensureUniversal(out);
      // Only a single app folder as they were identical
      expect(
        (await fs.readdir(path.resolve(out, 'Contents', 'Resources'))).filter((p) => p === 'app'),
      ).toEqual(['app']);
    }, 60000);
    it.todo('should create two separate non-identical app folders');
  });

  // TODO: Add tests for
  // * different app dirs with different macho files
  // * identical app dirs with universal macho files
});
