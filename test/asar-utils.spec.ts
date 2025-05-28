import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AsarMode, detectAsarMode, generateAsarIntegrity } from '../src/asar-utils.js';

const asarsPath = path.resolve(import.meta.dirname, 'fixtures', 'asars');
const appsPath = path.resolve(import.meta.dirname, 'fixtures', 'apps');

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
});
