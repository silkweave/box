import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Every core import shares one source module instance, including the test instance override.
const core = fileURLToPath(new URL('./src/', import.meta.url))
export default defineConfig({
  resolve: {
    conditions: ['@silkweave/box-source'],
    alias: [
      { find: /^@silkweave\/box-core$/, replacement: core + 'index.ts' },
      { find: /^@silkweave\/box-core\/(.*)$/, replacement: core + '$1.ts' },
    ],
  },
  // 10 s, not Vitest's 5: warehouse tests open a DuckDB instance per call and overran 5 s on a
  // loaded host. Keep this and the worker cap in step with apps/server/vitest.config.ts.
  test: { include: ['src/**/*.test.ts', '../../features/*/core/**/*.test.ts'], testTimeout: 10_000, maxWorkers: '50%', setupFiles: ['./vitest.setup.ts'] },
})
