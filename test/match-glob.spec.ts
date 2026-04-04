import { describe, expect, it } from 'vitest';

import { matchGlob } from '../src/file-utils.js';

describe('matchGlob', () => {
  describe('matchBase behavior (pattern without /)', () => {
    it('should match against basename when pattern has no slash', () => {
      expect(matchGlob('some/deep/path/hello-world', 'hello-world')).toBe(true);
    });

    it('should not match when basename differs', () => {
      expect(matchGlob('some/deep/path/other-file', 'hello-world')).toBe(false);
    });

    it('should support wildcard patterns against basename', () => {
      expect(matchGlob('path/to/hello-world-arm64', 'hello-world-*')).toBe(true);
      expect(matchGlob('path/to/goodbye-world', 'hello-world-*')).toBe(false);
    });

    it('should support glob character classes', () => {
      expect(matchGlob('path/to/file.txt', '*.txt')).toBe(true);
      expect(matchGlob('path/to/file.bin', '*.txt')).toBe(false);
    });
  });

  describe('full path matching (pattern with /)', () => {
    it('should match against full relative path when pattern contains /', () => {
      expect(matchGlob('SubApp.app/Contents/Info.plist', 'SubApp.app/Contents/Info.plist')).toBe(
        true,
      );
    });

    it('should not match when only basename matches but full path differs', () => {
      expect(matchGlob('Other.app/Contents/Info.plist', 'SubApp.app/Contents/Info.plist')).toBe(
        false,
      );
    });

    it('should support wildcards in path patterns', () => {
      expect(matchGlob('SubApp.app/Contents/Info.plist', '*/Contents/Info.plist')).toBe(true);
    });
  });
});
