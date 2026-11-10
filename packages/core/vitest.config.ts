import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { featureFixtures } from './vitest.features.ts'

// Every core import shares one source module instance, including the test instance override.
const core = fileURLToPath(new URL('./src/', import.meta.url))
export default defineConfig({
  plugins: [featureFixtures()],
  resolve: {
    conditions: ['@silkweave/box-source'],
    alias: [
      { find: /^@silkweave\/box-core$/, replacement: core + 'index.ts' },
      { find: /^@silkweave\/box-core\/(.*)$/, replacement: core + '$1.ts' },
    ],
  },
  // 10 s, not Vitest's 5: a loaded host overran 5 s. Keep this and the worker cap in step with
  // apps/server/vitest.config.ts. One database cluster per run (vitest.db-setup.ts); each test
  // file clones its migrated template (vitest.setup.ts).
  test: { include: ['src/**/*.test.ts', '../../features/*/core/**/*.test.ts'], testTimeout: 10_000, maxWorkers: '50%', setupFiles: ['./vitest.setup.ts'], globalSetup: ['./vitest.db-setup.ts'] },
})
