import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { transform } from '@swc/core'

// Every core import shares one source module instance, including the test instance override.
const INCLUDE = ['src/**/*.test.ts', 'scripts/**/*.test.ts', '../../features/*/server/**/*.test.ts']
// Suites whose tests spawn git or Bun child processes. Add a suite here when it starts doing so.
const PROCESS_SUITES = [
  'src/auth/auth-token-cli.test.ts',
  'src/builder/application-upgrade.test.ts',
  'src/builder/builder-lifecycle.test.ts',
  'src/builder/builder-review.test.ts',
]
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
  // 10 s, not Vitest's 5: warehouse tests open a DuckDB instance per call, so a loaded host (the
  // Box's own server, agents) overran 5 s. Suites that spawn real processes (git, the Bun CLI) get
  // their own project with a 60 s budget: Builder review and lifecycle tests make about 60 git
  // calls each, which is 0.5 s on an idle machine and more than 10 s on a Box host running Vite,
  // WorkerDeck and an agent turn beside `box verify`. The timeout catches hangs, not load; the git
  // helpers and CLI spawns carry their own shorter per-call timeouts.
  // Half the cores, not all but one: `box verify` often shares its host with a live Box, Vite and
  // an agent turn. The longest suite bounds wall time, so the cap costs nothing measurable here.
  test: {
    setupFiles: ['./vitest.setup.ts'], maxWorkers: '50%',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: INCLUDE, exclude: [...PROCESS_SUITES, '**/node_modules/**'], testTimeout: 10_000 },
      },
      {
        extends: true,
        test: { name: 'process', include: PROCESS_SUITES, testTimeout: 60_000, hookTimeout: 60_000 },
      },
    ],
  },
})
