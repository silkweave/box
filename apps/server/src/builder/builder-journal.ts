import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DiagnosticRecord } from '../diagnostics/runtime.js'

/**
 * The supervisor's own record of what happened, for the Builder session export: lifecycle and
 * supervisor diagnostics, its reports, and the application's and build's output lines. `box dev`
 * shows these in its terminal only and `box start` writes them to stdout, so without this file a
 * field tester's Box could not hand them over.
 *
 * `data/builder/journal.ndjson`, one JSON object per line, rotated to `journal.1.ndjson` at 4 MiB
 * (so at most 8 MiB). Request-level noise (http, proxy and ws events and heartbeats) is kept only
 * when it reports a failure. Writes are batched; a crash can lose the last quarter second.
 */
export interface JournalEntry {
  time: string
  source: string
  level: 'info' | 'warn' | 'error'
  event?: string
  text?: string
  fields?: Record<string, unknown>
}

const MAX_BYTES = 4 * 1024 * 1024
const MAX_LINE = 4_000
const FLUSH_MS = 250

export const journalPath = (instanceDir: string): string => join(instanceDir, 'builder', 'journal.ndjson')
const rotatedPath = (instanceDir: string): string => join(instanceDir, 'builder', 'journal.1.ndjson')

/** Request-level and heartbeat events are noise unless they report a failure. */
function keep(record: DiagnosticRecord): boolean {
  if (/(error|failed|timeout|refused|aborted)/.test(record.event)) return true
  if (/^(http|proxy|ws)\.|heartbeat/.test(record.event)) {
    const status = typeof record.status === 'number' ? record.status : 0
    const duration = typeof record.durationMs === 'number' ? record.durationMs : 0
    return status >= 500 || duration >= 5_000
  }
  return true
}

const levelOf = (record: DiagnosticRecord): JournalEntry['level'] =>
  /(error|failed|timeout|refused)/.test(record.event) ? 'error' : /(unavailable|aborted|signal)/.test(record.event) ? 'warn' : 'info'

export function createBuilderJournal(instanceDir: string) {
  const file = journalPath(instanceDir)
  let pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const flush = (): void => {
    timer = undefined
    if (!pending.length) return
    const chunk = pending.join('')
    pending = []
    try {
      mkdirSync(join(instanceDir, 'builder'), { recursive: true, mode: 0o700 })
      if (existsSync(file) && statSync(file).size + chunk.length > MAX_BYTES) renameSync(file, rotatedPath(instanceDir))
      appendFileSync(file, chunk, { mode: 0o600 })
    } catch { /* the journal is diagnostic; never let it break the supervisor */ }
  }
  const write = (entry: JournalEntry): void => {
    if (closed) return
    pending.push(`${JSON.stringify(entry)}\n`)
    timer ??= setTimeout(flush, FLUSH_MS)
    timer.unref?.()
  }
  return {
    diagnostic(record: DiagnosticRecord): void {
      if (!keep(record)) return
      const { time, pid: _pid, component, event, ...fields } = record
      write({ time, source: component, level: levelOf(record), event, ...(Object.keys(fields).length && { fields }) })
    },
    /** A line of child output (app, vite, build). Diagnostic JSON lines from the app are parsed. */
    output(source: string, level: 'info' | 'warn', line: string): void {
      try {
        const record = JSON.parse(line) as DiagnosticRecord
        if (record && typeof record.event === 'string' && typeof record.component === 'string') { this.diagnostic(record); return }
      } catch { /* ordinary output */ }
      const error = /\b(error|fatal|exception|failed)\b/i.test(line)
      write({ time: new Date().toISOString(), source, level: error ? 'error' : level, text: line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line })
    },
    report(level: JournalEntry['level'], message: string): void {
      write({ time: new Date().toISOString(), source: 'supervisor', level, text: message })
    },
    flush,
    close(): void { flush(); closed = true; if (timer) clearTimeout(timer) },
  }
}
export type BuilderJournal = ReturnType<typeof createBuilderJournal>

/** Entries at or after `since`, oldest first, across the rotated file and the current one. */
export function readJournal(instanceDir: string, since: Date): JournalEntry[] {
  const cutoff = since.toISOString()
  const entries: JournalEntry[] = []
  for (const file of [rotatedPath(instanceDir), journalPath(instanceDir)]) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as JournalEntry
        if (typeof entry.time === 'string' && entry.time >= cutoff) entries.push(entry)
      } catch { /* a torn last line */ }
    }
  }
  return entries
}
