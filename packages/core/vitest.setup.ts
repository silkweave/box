// Every test file starts on its own empty instance directory and its own database (a clone of the
// run's migrated template, vitest.db-setup.ts). A test that needs particular state calls
// setInstanceDir itself; one that forgets can no longer read or write the live Box's data/, and
// core's instanceDir() refuses the live path under Vitest in any case (packages/core/src/io.ts).
// Test bodies run without a context frame; here that is system work (setFramelessScopeForTests),
// never in production.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, inject } from 'vitest'
import { setFramelessScopeForTests, setInstanceDir, useTestDatabase, type TestDatabase } from '@silkweave/box-core/testing'

const dir = mkdtempSync(join(tmpdir(), 'box-test-instance-'))
setInstanceDir(dir)
setFramelessScopeForTests({ kind: 'system', reason: 'test' })
let db: TestDatabase | undefined
beforeAll(async () => {
  db = await useTestDatabase(inject('boxDb'))
})
afterAll(async () => {
  await db?.drop()
  rmSync(dir, { recursive: true, force: true })
})
