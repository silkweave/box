import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createBuilderJournal, hostLoad, readJournal } from './builder-journal.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const instance = (): string => { const dir = mkdtempSync(join(tmpdir(), 'journal-')); dirs.push(dir); return dir }
const wait = (time: string, route = '/:path') => ({ time, pid: 1, component: 'supervisor', event: 'http.wait', route, durationMs: 20_000 })

test('a request storm keeps its first entries per minute and counts the rest, so its start survives', () => {
  const dir = instance()
  const journal = createBuilderJournal(dir)
  journal.diagnostic({ time: '2026-11-24T09:03:59.000Z', pid: 1, component: 'lifecycle', event: 'vite.restart' })
  for (let i = 0; i < 50; i++) journal.diagnostic(wait('2026-11-24T09:04:10.000Z'))
  for (let i = 0; i < 5; i++) journal.diagnostic(wait('2026-11-24T09:04:20.000Z', '/:page'))
  journal.diagnostic(wait('2026-11-24T09:05:01.000Z'))
  journal.close()
  const entries = readJournal(dir, new Date(0))
  expect(entries[0]?.event).toBe('vite.restart')
  expect(entries.filter(e => e.event === 'http.wait' && e.fields?.route === '/:path')).toHaveLength(21)
  expect(entries.filter(e => e.event === 'http.wait' && e.fields?.route === '/:page')).toHaveLength(5)
  const condensed = entries.filter(e => e.event === 'journal.condensed')
  expect(condensed).toHaveLength(1)
  expect(condensed[0]?.fields).toMatchObject({ event: 'http.wait', route: '/:path', minute: '2026-11-24T09:04', dropped: 30 })
})

test('a host load sample names load, memory and, on macOS, the pressure level', () => {
  const sample = hostLoad()
  expect(sample).toMatchObject({ cpus: expect.any(Number), memoryMb: expect.any(Number), freeMb: expect.any(Number) })
  expect(sample.load).toHaveLength(3)
  if (process.platform === 'darwin') expect([1, 2, 4]).toContain(sample.pressure)
})
