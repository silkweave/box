// Reclaiming a dead holder's lock file (db/cluster.ts): serialized by a kernel lock, and never
// removing a lock another process has taken over in the meantime.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reclaimStaleLock } from './cluster.js'
import { withFileLock } from './flock.js'

let dir: string
let lock: string
const DEAD = JSON.stringify({ pid: 2 ** 22 + 12345, role: 'cli', since: '2026-01-01T00:00:00.000Z' })
const LIVE = JSON.stringify({ pid: process.pid, role: 'supervisor', since: new Date().toISOString() })

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'box-lock-')); lock = join(dir, 'owner.lock') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('stale lock reclamation', () => {
  it('removes a stale lock that still holds what was read', () => {
    writeFileSync(lock, DEAD)
    expect(reclaimStaleLock(lock, DEAD)).toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  it('never removes a lock taken over after the stale one was read (A reads, B reclaims and links, A resumes)', () => {
    writeFileSync(lock, DEAD)
    const readByA = readFileSync(lock, 'utf8')
    expect(reclaimStaleLock(lock, readFileSync(lock, 'utf8'))).toBe(true) // B
    writeFileSync(lock, LIVE, { flag: 'wx' })                            // B's live lock
    expect(reclaimStaleLock(lock, readByA)).toBe(false)                   // A
    expect(readFileSync(lock, 'utf8')).toBe(LIVE)
  })

  it('does not reclaim while another reclaimer holds the kernel lock', () => {
    writeFileSync(lock, DEAD)
    const inside = withFileLock(`${lock}.reclaim`, () => reclaimStaleLock(lock, DEAD))
    expect(inside).toEqual({ value: false })
    expect(existsSync(lock)).toBe(true)
    expect(reclaimStaleLock(lock, DEAD)).toBe(true)
  })
})
