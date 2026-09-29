import { defineConfig } from 'tsdown'

// Same posture as @silkweave/box-core: build to build/ on prepack/CI only, never in dev - consumers resolve
// the `@silkweave/box-source` export condition straight to src/.
export default defineConfig({
  entry: ['./src/index.ts'],
  outDir: 'build',
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  deps: { neverBundle: [/^[^./]/] },
})
