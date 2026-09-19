import { defineConfig } from 'tsdown'

// Build @silkweave/box-core to build/ (ESM + .d.mts). Runs only on prepack/CI (turbo `^build`), never in dev -
// apps resolve the `@silkweave/box-source` export condition straight to src/ during development.
export default defineConfig({
  // `testing` is the second entry so the `./testing` subpath in package.json names a real file in
  // the built form too (src/testing.ts: setInstanceDir for typegen and tests, off the public index).
  entry: ['./src/index.ts', './src/testing.ts'],
  outDir: 'build',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep every bare dependency external (duckdb native addon, playwright, etc.).
  deps: { neverBundle: [/^[^./]/] },
})
