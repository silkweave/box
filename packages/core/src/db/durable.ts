// Crash-durable file writes for the database's control records (active.json, the operation journal,
// restore-point manifests): write a temp file, fsync it, rename it over the target, fsync the
// directory. A crash leaves the old or the new content, and a completed write survives power loss.
//
// A directory fsync the filesystem does not support (EINVAL, ENOTSUP, EISDIR on some platforms) is
// skipped: there is nothing more to flush. Every other failure (EIO, ENOSPC, EBADF) throws, because
// the caller is about to rely on the write being durable.

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

const UNSUPPORTED_DIR_SYNC = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])

export function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) }
  catch (e) { if (!UNSUPPORTED_DIR_SYNC.has((e as NodeJS.ErrnoException).code ?? '')) throw e }
  finally { closeSync(fd) }
}

export function writeDurable(file: string, text: string, mode = 0o600): void {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    const fd = openSync(tmp, 'wx', mode)
    try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  fsyncDir(dir)
}

export function writeJsonDurable(file: string, value: unknown, mode = 0o600): void {
  writeDurable(file, `${JSON.stringify(value, null, 2)}\n`, mode)
}

/** Replace a text file durably, keeping its permission bits (configuration files). */
export function replaceTextDurable(file: string, text: string): void {
  let mode = 0o644
  try { mode = statSync(file).mode & 0o777 } catch { /* new file */ }
  writeDurable(file, text, mode)
}

/** Rename and fsync both parent directories. */
export function renameDurable(from: string, to: string): void {
  renameSync(from, to)
  fsyncDir(dirname(to))
  if (dirname(from) !== dirname(to)) fsyncDir(dirname(from))
}

/** fsync one file's content (after copying it into place). */
export function fsyncFile(file: string): void {
  const fd = openSync(file, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** fsync every regular file and directory under `path` (a file or a directory; symlinks are not
 *  followed), deepest first, so staged content is on disk before a journal relies on it. */
export function fsyncTree(path: string): void {
  let st
  try { st = lstatSync(path) } catch { return }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) fsyncTree(join(path, name))
    fsyncDir(path)
  } else if (st.isFile()) fsyncFile(path)
}
