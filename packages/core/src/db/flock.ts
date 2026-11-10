// A kernel advisory lock (flock(2)) for short critical sections between processes. The kernel
// releases it when the holder exits, however it exits, so it never goes stale; that is what the
// owner and maintenance lock files cannot do on their own when a dead holder's file is reclaimed.
// Bun is the runtime: flock is called through bun:ffi. Where that is unavailable the caller fails
// closed (it does not reclaim) rather than racing.

import { closeSync, openSync } from 'node:fs'
import { createRequire } from 'node:module'

const LOCK_EX = 2
const LOCK_NB = 4
const LOCK_UN = 8

interface Ffi {
  dlopen(path: string, symbols: Record<string, { args: string[]; returns: string }>): { symbols: { flock(fd: number, op: number): number } }
}

let flockFn: ((fd: number, op: number) => number) | null | undefined

function load(): ((fd: number, op: number) => number) | null {
  if (flockFn !== undefined) return flockFn
  try {
    const ffi = createRequire(import.meta.url)('bun:ffi') as Ffi
    const libc = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6'
    flockFn = ffi.dlopen(libc, { flock: { args: ['i32', 'i32'], returns: 'i32' } }).symbols.flock
  } catch {
    flockFn = null
  }
  return flockFn
}

export class FileLockUnavailable extends Error {}

/**
 * Run `fn` while holding an exclusive kernel lock on `file` (created if needed). Returns null at
 * once when another open file holds it. Throws FileLockUnavailable where kernel locks cannot be
 * taken from this runtime.
 */
export function withFileLock<T>(file: string, fn: () => T): { value: T } | null {
  const flock = load()
  if (!flock) throw new FileLockUnavailable('kernel file locks are unavailable in this runtime (Bun is required)')
  const fd = openSync(file, 'a', 0o600)
  try {
    if (flock(fd, LOCK_EX | LOCK_NB) !== 0) return null
    try { return { value: fn() } } finally { flock(fd, LOCK_UN) }
  } finally { closeSync(fd) }
}
