import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { transform } from '@swc/core'

// Every core import shares one source module instance, including the test instance override.
const core = fileURLToPath(new URL('../../packages/core/src/', import.meta.url))
export default defineConfig({
  // Feature files sit outside this package's tsconfig discovery root. Apply the same Nest
  // decorator transform as the server build before Vite parses them for tests.
  plugins: [{
    name: 'server-decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.ts') || !/\/(?:apps\/server|features\/[^/]+\/server)\//.test(id)) return
      return transform(code, {
        filename: id,
        sourceMaps: true,
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
          keepClassNames: true,
        },
        module: { type: 'es6' },
      })
    },
  }],
  resolve: {
    conditions: ['@silkweave/box-source'],
    alias: [
      { find: /^@silkweave\/box-core$/, replacement: core + 'index.ts' },
      { find: /^@silkweave\/box-core\/(.*)$/, replacement: core + '$1.ts' },
    ],
  },
  // 10 s, not Vitest's 5: Builder review tests make hundreds of git calls and warehouse tests open
  // a DuckDB instance per call, so a loaded host (the Box's own server, agents) overran 5 s.
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', '../../features/*/server/**/*.test.ts'],
    testTimeout: 10_000, setupFiles: ['./vitest.setup.ts'],
  },
})
