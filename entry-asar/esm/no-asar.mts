import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

if (process.arch === 'arm64') {
  await setPaths('arm64');
} else {
  await setPaths('x64');
}

async function setPaths(platform: string) {
  // This should return the full path, ending in something like
  // Notion.app/Contents/Resources/app
  const appPath = app.getAppPath();
  const appFolder = `app-${platform}`;

  // Maybe we'll handle this in Electron one day
  if (path.basename(appPath) === 'app') {
    const platformAppPath = path.join(path.dirname(appPath), appFolder);

    // This is an undocumented private API. It exists.
    app.setAppPath(platformAppPath);
  }

  process._archPath = require.resolve(`../${appFolder}`);
  await import(pathToFileURL(process._archPath).href);
}
