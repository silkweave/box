// Reads and writes interleaved in one process. Before the read/write gate in db.ts, a read-only
// instance opened while a write was extending the file could fail with "IO Error: Could not read
// enough bytes" (seen during a large CRM import). This drives the same pattern hard and expects
// every call to succeed and every write to be visible.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../io.js'
import { withRead, withWrite } from './db.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-db-gate-'))
  setInstanceDir(dir)
  await withWrite((conn) => conn.run(`CREATE TABLE gate_probe (id INTEGER PRIMARY KEY, body VARCHAR)`))
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('withRead and withWrite in one process', () => {
  it('never lets a read overlap a write', async () => {
    const body = 'x'.repeat(20_000) // enough per row to make every write grow the file
    const calls: Promise<unknown>[] = []
    for (let i = 0; i < 40; i++) {
      calls.push(withWrite((conn) => conn.run(`INSERT INTO gate_probe VALUES (?, ?)`, [i, body])))
      for (let r = 0; r < 4; r++) calls.push(withRead(`SELECT count(*) AS n FROM gate_probe`))
    }
    await expect(Promise.all(calls)).resolves.toBeDefined()
    const [row] = await withRead<{ n: number }>(`SELECT count(*) AS n FROM gate_probe`)
    expect(Number(row.n)).toBe(40)
  }, 120_000)
})
