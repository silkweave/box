import { defineConfig } from 'tsdown'

// Build @silkweave/box-core to build/ (ESM + .d.mts). Runs only on prepack/CI (turbo `^build`), never in dev -
// apps resolve the `@silkweave/box-source` export condition straight to src/ during development.
export default defineConfig({
  // `testing` is the second entry so the `./testing` subpath in package.json names a real file in
  // the built form too (src/testing.ts: setInstanceDir for typegen and tests, off the public index).
  entry: ['./src/index.ts', './src/testing.ts'],
  outDir: 'build',
  format: ['esm'],
  // TS7 only: force tsgo so a transitively installed TypeScript 5 never becomes the generator. tsgo
  // passes `--rootDir <directory of the tsconfig>`, and core also compiles features/*/core, so the
  // declaration build reads a repo-root tsconfig that extends this package's (docs/GOTCHAS.md).
  dts: { generator: 'tsgo', tsconfig: '../../tsconfig.core-build.json' },
  sourcemap: true,
  clean: true,
  // Keep every bare dependency external (duckdb native addon, playwright, etc.).
  deps: { neverBundle: [/^[^./]/] },
})
