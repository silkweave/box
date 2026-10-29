// Archived signals: hidden from the list reads that ask for it, still readable themselves.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { readSignalDefinition, readSignalDefinitions, setSignalArchived, upsertSignalDefinition } from './definitions.js'
import { readSignalPoints, setSignalPoint } from './points.js'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'box-signal-archive-'))
  setInstanceDir(root)
})
afterAll(() => {
  resetInstanceDir()
  rmSync(root, { recursive: true, force: true })
})

test('archive hides a signal from lists that exclude archived, keeps it readable, and unarchive brings it back', async () => {
  await upsertSignalDefinition({ id: 'old-kpi', label: 'Old KPI' })
  await upsertSignalDefinition({ id: 'mrr', label: 'MRR' })
  await setSignalPoint({ signal_id: 'old-kpi', at: '2026-10-01', value: 5 })
  const archived = await setSignalArchived('old-kpi', true)
  expect(archived.archived_at).not.toBeNull()
  // Idempotent: the first stamp stays.
  expect((await setSignalArchived('old-kpi', true)).archived_at).toBe(archived.archived_at)
  expect((await readSignalDefinitions({ includeArchived: false })).map((d) => d.id)).toEqual(['mrr'])
  expect((await readSignalDefinitions()).map((d) => d.id).sort()).toEqual(['mrr', 'old-kpi'])
  expect((await readSignalPoints('old-kpi')).map((p) => p.value)).toEqual([5])
  // An edit keeps it archived.
  expect((await upsertSignalDefinition({ id: 'old-kpi', label: 'Old KPI (retired)' })).archived_at).toBe(archived.archived_at)
  await setSignalArchived('old-kpi', false)
  expect((await readSignalDefinition('old-kpi'))?.archived_at).toBeNull()
  await expect(setSignalArchived('nope', true)).rejects.toThrow(/not found/)
})
