import path from 'path';
import fs from 'fs-extra';
import { Filesystem } from '@electron/asar/lib/filesystem';
import { readFilesystemSync } from '@electron/asar/lib/disk';

/**
 * Directory structure:
 * tmp
 * ├── private
 * │   └── var
 * │       ├── app
 * │       │   └── file.txt -> ../file.txt
 * │       └── file.txt
 * └── var -> private/var
 */
export const createSymlinkedApp = async (testName: string) => {
  const randomName = 'app' + Math.floor(Math.random() * 100);
  const tmpPath = path.join(__dirname, 'fixtures', 'apps', testName || randomName);
  const privateVarPath = path.join(tmpPath, 'private', 'var');
  const varPath = path.join(tmpPath, 'var');

  await fs.mkdir(privateVarPath, { recursive: true });
  await fs.symlink(path.relative(tmpPath, privateVarPath), varPath);

  const originFilePath = path.join(varPath, 'file.txt');
  await fs.writeFile(originFilePath, 'hello world');
  const appPath = path.join(varPath, 'app');
  await fs.mkdirp(appPath);
  await fs.symlink('../file.txt', path.join(appPath, 'file.txt'));

  const ordering = walk(tmpPath).map((filepath) => filepath.substring(tmpPath.length)); // convert to paths relative to root

  return {
    appPath,
    tmpPath,
    varPath,
    // helper function for generating the `ordering.txt` file data
    buildOrderingData: (getProps) =>
      ordering.reduce((prev, curr) => {
        return `${prev}${curr}:${JSON.stringify(getProps(curr))}\n`;
      }, ''),
  };
};

// returns a list of all directories, files, and symlinks. Automates testing `ordering` logic easy.
export const walk = (root) => {
  const getPaths = (filepath, filter) =>
    fs
      .readdirSync(filepath, { withFileTypes: true })
      .filter((dirent) => filter(dirent))
      .map(({ name }) => path.join(filepath, name));

  const dirs = getPaths(root, (dirent) => dirent.isDirectory());
  const files = dirs.map((dir) => walk(dir)).flat();
  return files.concat(
    dirs,
    getPaths(root, (dirent) => dirent.isFile() || dirent.isSymbolicLink()),
  );
};

export function toSystemIndependentPath(s: string) {
  return path.sep === '/' ? s : s.replace(/\\/g, '/');
}

export function removeUnstableProperties(data: any) {
  return JSON.parse(
    JSON.stringify(data, (name, value) => {
      if (name === 'offset') {
        return undefined;
      }
      return value;
    }),
  );
}

export const verifySmartUnpack = async (
  asarPath: string,
  additionalVerifications?: (asarFilesystem: Filesystem) => Promise<void>,
) => {
  const asarFs = readFilesystemSync(asarPath);

  // for verifying additional files within the Asar Filesystem
  await additionalVerifications?.(asarFs);

  // verify header
  expect(removeUnstableProperties(asarFs.getHeader())).toMatchSnapshot();

  const unpackedDirPath = `${asarPath}.unpacked`;
  if (!fs.existsSync(unpackedDirPath)) {
    return;
  }
  const files = (await walk(unpackedDirPath)).map((it: string) => {
    const name = toSystemIndependentPath(it.substring(unpackedDirPath.length + 1));
    if (it.endsWith('.txt') || it.endsWith('.json')) {
      return { name, content: fs.readFileSync(it, 'utf-8') };
    }
    return name;
  });
  expect(files).toMatchSnapshot();
};
