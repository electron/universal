if (process.arch === 'arm64') {
  process._asarPath = require.resolve('../arm64.app.asar');
} else {
  process._asarPath = require.resolve('../x64.app.asar');
}

require(process._asarPath);
