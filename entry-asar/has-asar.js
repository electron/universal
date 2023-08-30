if (process.arch === 'arm64') {
  setPaths('arm64');
} else {
  setPaths('x64');
}

function setPaths(platform) {
  // This should return the full path, ending in something like
  // Notion.app/Contents/Resources/app.asar
  const appPath = app.getAppPath()
  const asarFile = `app-${platform}.asar`

  // Maybe we'll handle this in Electron one day
  if (appPath.includes('app.asar')) {
    const platformAppPath = appPath.replace(/\.app\.asar$/, asarFile)

    // This is an undocumented API. It exists.
    app.setAppPath(platformAppPath)
  }

  process._archPath = require.resolve(`../${asarFile}`);
}

require(process._archPath);
