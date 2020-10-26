# @electron/universal

> Create universal macOS Electron applicatiojns

[![CircleCI](https://circleci.com/gh/electron/universal.svg?style=svg)](https://circleci.com/gh/electron/universal)

## Disclaimer

Work In Progress

## Usage


```typescript
import { makeUniversalApp } from '@electron/universal';

await makeUniversalApp({
  x64AppPath: 'path/to/App_x64.app',
  arm64AppPath: 'path/to/App_arm64.app',
  outAppPath: 'path/to/App_universal.app',
});
```
