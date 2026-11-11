import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { featureFixtures } from './vitest.features.ts'
import { boxScope, CORE_SMOKE } from './vitest.scope.ts'

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
  // 10 s, not Vitest's 5: a loaded host overran 5 s. Hooks get 30 s: setup and teardown start and
  // stop database servers and write roles, which ran past 10 s on a 4-vCPU Box host during verify. Keep this and the worker cap in step with
  // apps/server/vitest.config.ts. One database cluster per run (vitest.db-setup.ts); each test
  // file clones its migrated template (vitest.setup.ts).
  // A Box with unchanged core runs its features' tests and the core smoke set (vitest.scope.ts).
  test: { include: boxScope ? [...CORE_SMOKE, '../../features/*/core/**/*.test.ts'] : ['src/**/*.test.ts', '../../features/*/core/**/*.test.ts'], passWithNoTests: boxScope, testTimeout: 10_000, hookTimeout: 30_000, maxWorkers: '50%', setupFiles: ['./vitest.setup.ts'], globalSetup: ['./vitest.db-setup.ts'] },
})
