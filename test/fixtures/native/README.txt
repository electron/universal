Arch-specific modules generated from `node-mac-permissions` (https://github.com/codebytere/node-mac-permissions) using `electron/rebuild`

Universal module generated with `lipo`
```
lipo ./test/fixtures/native/node-mac-permissions.x64.node ./test/fixtures/native/node-mac-permissions.arm64.node -create -output ./test/fixtures/native/node-mac-permissions.universal.node
```