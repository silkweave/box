// Every test file starts on its own empty instance directory. A test that needs particular state
// calls setInstanceDir itself; one that forgets can no longer read or write the live Box's data/,
// and core's instanceDir() refuses the live path under Vitest in any case (packages/core/src/io.ts).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { setInstanceDir } from '@silkweave/box-core/testing'

const dir = mkdtempSync(join(tmpdir(), 'box-test-instance-'))
setInstanceDir(dir)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
