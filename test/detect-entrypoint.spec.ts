import { describe, expect, it } from 'vitest';

import { detectEntrypointModule, EntrypointModule, resolveShimModule } from '../dist/asar-utils.js';

describe('detectEntrypointModule', () => {
  it('detects ESM when main has a .mjs extension', () => {
    expect(detectEntrypointModule({ main: 'index.mjs' })).toBe(EntrypointModule.ESM);
  });

  it('detects ESM for a nested .mjs main', () => {
    expect(detectEntrypointModule({ main: 'src/app.mjs' })).toBe(EntrypointModule.ESM);
  });

  it('detects CJS when main has a .cjs extension', () => {
    expect(detectEntrypointModule({ main: 'index.cjs' })).toBe(EntrypointModule.CJS);
  });

  it('lets the .cjs extension win over a "module" type', () => {
    expect(detectEntrypointModule({ main: 'index.cjs', type: 'module' })).toBe(
      EntrypointModule.CJS,
    );
  });

  it('lets the .mjs extension win over a "commonjs" type', () => {
    expect(detectEntrypointModule({ main: 'index.mjs', type: 'commonjs' })).toBe(
      EntrypointModule.ESM,
    );
  });

  it('detects ESM for a .js main when type is "module"', () => {
    expect(detectEntrypointModule({ main: 'index.js', type: 'module' })).toBe(EntrypointModule.ESM);
  });

  it('detects CJS for a .js main when type is "commonjs"', () => {
    expect(detectEntrypointModule({ main: 'index.js', type: 'commonjs' })).toBe(
      EntrypointModule.CJS,
    );
  });

  it('defaults a .js main with no type to CJS', () => {
    expect(detectEntrypointModule({ main: 'index.js' })).toBe(EntrypointModule.CJS);
  });

  it('detects ESM when type is "module" and there is no main', () => {
    expect(detectEntrypointModule({ type: 'module' })).toBe(EntrypointModule.ESM);
  });

  it('defaults an empty package.json to CJS', () => {
    expect(detectEntrypointModule({})).toBe(EntrypointModule.CJS);
  });

  it('treats null as CJS', () => {
    expect(detectEntrypointModule(null)).toBe(EntrypointModule.CJS);
  });

  it('treats a non-object as CJS', () => {
    expect(detectEntrypointModule(42)).toBe(EntrypointModule.CJS);
  });
});

describe('resolveShimModule', () => {
  it('returns CJS when both arches are CJS', () => {
    expect(resolveShimModule(EntrypointModule.CJS, EntrypointModule.CJS)).toBe(
      EntrypointModule.CJS,
    );
  });

  it('returns ESM when both arches are ESM', () => {
    expect(resolveShimModule(EntrypointModule.ESM, EntrypointModule.ESM)).toBe(
      EntrypointModule.ESM,
    );
  });

  it('throws when x64 is ESM but arm64 is CJS', () => {
    expect(() => resolveShimModule(EntrypointModule.ESM, EntrypointModule.CJS)).toThrow(
      /ESM[\s\S]*CJS/,
    );
  });

  it('throws when x64 is CJS but arm64 is ESM', () => {
    expect(() => resolveShimModule(EntrypointModule.CJS, EntrypointModule.ESM)).toThrow(
      /CJS[\s\S]*ESM/,
    );
  });
});
