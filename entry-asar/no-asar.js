if (process.arch === 'arm64') {
  setPaths('arm64');
} else {
  setPaths('x64');
}

function setPaths(platform) {
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
}

require(process._archPath);
