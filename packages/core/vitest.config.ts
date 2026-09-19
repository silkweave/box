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
  test: { include: ['src/**/*.test.ts', '../../features/*/core/**/*.test.ts'] },
})
