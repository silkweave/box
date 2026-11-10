// The commit's file swaps (db/switch.ts applySwap / undoSwap) on plain directories: every state a
// commit or a rollback can be interrupted in, undone repeatedly, must leave the original bytes.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySwap, undoSwap, type JournalSwap } from './switch.js'

let root: string

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'box-swap-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** A directory swap and a root-config file swap, with live (old) and staged (new) content. */
function setup(kind: 'dir' | 'file', o: { hadLive: boolean; hasStaged: boolean }): JournalSwap {
  const w: JournalSwap = { live: join(root, `live-${kind}`), staged: join(root, `staged-${kind}`), parked: join(root, `parked-${kind}`), ...o }
  const put = (path: string, text: string) => {
    if (kind === 'dir') { mkdirSync(path); writeFileSync(join(path, 'a.md'), text) } else writeFileSync(path, text)
  }
  if (o.hadLive) put(w.live, 'OLD')
  if (o.hasStaged) put(w.staged, 'NEW')
  return w
}

function content(path: string): string | null {
  if (!existsSync(path)) return null
  try { return readFileSync(join(path, 'a.md'), 'utf8') } catch { return readFileSync(path, 'utf8') }
}

/** States a commit passes through, reached step by step as applySwap does them. */
const commitStates = (w: JournalSwap): (() => void)[] => [
  () => { /* not applied */ },
  () => { if (w.hadLive) renameSync(w.live, w.parked) },
  () => applySwap(w),
]

describe('swap undo is repeatable and never loses the original', () => {
  for (const kind of ['dir', 'file'] as const) {
    for (const hadLive of [true, false]) {
      for (const hasStaged of [true, false]) {
        if (!hadLive && !hasStaged) continue
        it(`${kind}, hadLive=${hadLive}, hasStaged=${hasStaged}`, () => {
          for (let reached = 0; reached < 3; reached++) {
            rmSync(root, { recursive: true, force: true }); mkdirSync(root)
            const w = setup(kind, { hadLive, hasStaged })
            const steps = commitStates(w)
            for (let i = 0; i <= reached; i++) steps[i]!()
            // An interrupted undo (the restored copy removed, the parked one not yet back), then
            // two complete undos, as repeated recoveries would run them.
            if (reached === 2 && hadLive && existsSync(w.live)) rmSync(w.live, { recursive: true, force: true })
            undoSwap(w)
            undoSwap(w)
            expect(content(w.live)).toBe(hadLive ? 'OLD' : null)
            expect(existsSync(w.parked)).toBe(false)
            expect(existsSync(w.staged)).toBe(false)
            expect(readdirSync(root).length).toBe(hadLive ? 1 : 0)
          }
        })
      }
    }
  }

  it('applies repeatably and refuses a state it cannot explain', () => {
    const w = setup('dir', { hadLive: true, hasStaged: true })
    applySwap(w)
    applySwap(w)
    expect(content(w.live)).toBe('NEW')
    expect(content(w.parked)).toBe('OLD')
    rmSync(w.parked, { recursive: true })
    expect(() => applySwap(w)).toThrow(/never parked/)
    expect(content(w.live)).toBe('NEW')
  })
})
