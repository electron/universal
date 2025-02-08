import * as path from 'path';
import fs from 'fs-extra';

import {
  AsarMode,
  detectAsarMode,
  generateAsarIntegrity,
  generateOrderingConfig,
  toRelativePath,
} from '../src/asar-utils';
import asar from '@electron/asar';

const asarsPath = path.resolve(__dirname, 'fixtures', 'asars');
const appsPath = path.resolve(__dirname, 'fixtures', 'apps');
const appsOutPath = path.resolve(__dirname, 'fixtures', 'apps', 'out');

describe('asar-utils', () => {
  describe('detectAsarMode', () => {
    it('should correctly detect an asar enabled app', async () => {
      expect(await detectAsarMode(path.resolve(appsPath, 'Arm64Asar.app'))).toBe(AsarMode.HAS_ASAR);
    });

    it('should correctly detect an app without an asar', async () => {
      expect(await detectAsarMode(path.resolve(appsPath, 'Arm64NoAsar.app'))).toBe(
        AsarMode.NO_ASAR,
      );
    });
  });

  describe('generateAsarIntegrity', () => {
    it('should deterministically hash an asar header', async () => {
      expect(generateAsarIntegrity(path.resolve(asarsPath, 'app.asar')).hash).toEqual(
        '85fff474383bd8df11cd9c5784e8fcd1525af71ff140a8a882e1dc9d5b39fcbf',
      );
    });
  });

  describe('generateOrderingConfig', () => {
    it('should properly read `unpacked` flag and generate ordering config', async () => {
      const identicalArchAsar = path.resolve(asarsPath, 'app-with-unpacked-flags.asar');
      const files = new Set(
        asar.listPackage(identicalArchAsar, { isPack: false }).map(toRelativePath),
      );
      const ordering = await generateOrderingConfig(
        {
          asarPath: identicalArchAsar,
          files,
        },
        {
          asarPath: identicalArchAsar,
          files,
        },
      );
      const orderingConfig = await fs.readFile(ordering, 'utf-8');
      expect(orderingConfig).toMatchSnapshot();
    });
  });
});
