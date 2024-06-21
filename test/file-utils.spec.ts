import * as path from 'path';

import { AppFile, AppFileType, getAllAppFiles } from '../src/file-utils';

const appsPath = path.resolve(__dirname, 'fixtures', 'apps');

describe('file-utils', () => {
  describe('getAllAppFiles', () => {
    let asarFiles: AppFile[];
    let noAsarFiles: AppFile[];

    beforeAll(async () => {
      asarFiles = await getAllAppFiles(path.resolve(appsPath, 'Arm64Asar.app'));
      noAsarFiles = await getAllAppFiles(path.resolve(appsPath, 'Arm64NoAsar.app'));
    });

    it('should correctly identify plist files', async () => {
      expect(asarFiles.find((f) => f.relativePath === 'Contents/Info.plist')?.type).toBe(
        AppFileType.INFO_PLIST,
      );
    });

    it('should correctly identify asar files as app code', async () => {
      expect(asarFiles.find((f) => f.relativePath === 'Contents/Resources/app.asar')?.type).toBe(
        AppFileType.APP_CODE,
      );
    });

    it('should correctly identify non-asar code files as plain text', async () => {
      expect(
        noAsarFiles.find((f) => f.relativePath === 'Contents/Resources/app/index.js')?.type,
      ).toBe(AppFileType.PLAIN);
    });

    it('should correctly identify the Electron binary as Mach-O', async () => {
      expect(noAsarFiles.find((f) => f.relativePath === 'Contents/MacOS/Electron')?.type).toBe(
        AppFileType.MACHO,
      );
    });

    it('should correctly identify the Electron Framework as Mach-O', async () => {
      expect(
        noAsarFiles.find(
          (f) =>
            f.relativePath ===
            'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
        )?.type,
      ).toBe(AppFileType.MACHO);
    });

    it('should correctly identify the v8 context snapshot', async () => {
      expect(
        noAsarFiles.find(
          (f) =>
            f.relativePath ===
            'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/v8_context_snapshot.arm64.bin',
        )?.type,
      ).toBe(AppFileType.SNAPSHOT);
    });
  });
});
