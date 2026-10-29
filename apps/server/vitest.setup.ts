// Every test file starts on its own empty instance directory. A test that needs particular state
// calls setInstanceDir itself; one that forgets can no longer read or write the live Box's data/,
// and core's instanceDir() refuses the live path under Vitest in any case (packages/core/src/io.ts).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { holdWarehouseOpen, releaseWarehouse, setInstanceDir } from '@silkweave/box-core/testing'

const dir = mkdtempSync(join(tmpdir(), 'box-test-instance-'))
setInstanceDir(dir)
// One DuckDB instance per database file for the whole test file instead of one per query.
holdWarehouseOpen(true)
afterAll(() => {
  releaseWarehouse()
  rmSync(dir, { recursive: true, force: true })
})

// Test git runs against throwaway repositories and must not inherit the host's git setup: a global
// hook, commit signing, fsmonitor or credential helper on a Box host made the Builder review tests
// slow or interactive there while they passed elsewhere. Repositories set their own identity.
const gitConfig = join(dir, 'gitconfig')
writeFileSync(gitConfig, '')
process.env.GIT_CONFIG_GLOBAL = gitConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_TERMINAL_PROMPT = '0'
