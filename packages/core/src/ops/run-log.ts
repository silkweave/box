// The live log of an active run, shared by action runs (run.ts) and agent runs (the automation
// feature's AgentRunsService). While a run is queued or running its lines live here: readRun()
// returns them in place of the row's log, so `run-get` / opsRun show a run while it happens, and a
// throttled flush writes them to the row, so a crash or restart keeps the log up to the last flush
// (markOrphanedRuns then closes it with a line). finalizeRun() stays the terminal write.
//
// Each line gets a per-run `seq` (0, 1, 2, ...), kept when the cap drops old lines, so a poller can
// ask for "after seq N" and never see a line twice. Stored rows without `seq` read as their index.

import { withWrite } from '../warehouse/db.js'
import type { RunLogLine } from './types.js'

/** Keep the last N lines per run (backfills can stream thousands). */
export const RUN_LOG_CAP = 2000

/** At most one flush per run per this interval, and only when something changed. */
export const RUN_LOG_FLUSH_MS = 5_000

interface LiveLog {
  lines: RunLogLine[]
  next: number
  timer: ReturnType<typeof setTimeout> | null
  /** A flush is writing; a line pushed meanwhile schedules the next one. */
  flushing: Promise<void> | null
}

const live = new Map<string, LiveLog>()

const ensure = (runId: string): LiveLog => {
  let log = live.get(runId)
  if (!log) {
    log = { lines: [], next: 0, timer: null, flushing: null }
    live.set(runId, log)
  }
  return log
}

/** Write the live lines to the row while it is still queued or running; a settled row is never touched. */
async function flush(runId: string): Promise<void> {
  const log = live.get(runId)
  if (!log) return
  log.timer = null
  const lines = JSON.stringify(log.lines)
  const write = withWrite(async (conn) => {
    await conn.run(`UPDATE automation_runs SET log = ?::JSON WHERE id = ? AND status IN ('queued', 'running')`, [lines, runId])
  }).catch((err: unknown) => {
    console.error(`[ops] run log flush failed for ${runId}: ${String((err as Error)?.message ?? err)}`)
  })
  log.flushing = write
  await write
  if (log.flushing === write) log.flushing = null
}

function schedule(runId: string, log: LiveLog): void {
  if (log.timer) return
  log.timer = setTimeout(() => void flush(runId), RUN_LOG_FLUSH_MS)
  log.timer.unref?.()
}

/** Append one line to a run's live log (stamping `ts` and `seq` when missing) and schedule a flush. */
export function appendRunLog(runId: string, line: Omit<RunLogLine, 'ts' | 'seq'> & { ts?: string }): RunLogLine {
  const log = ensure(runId)
  const entry: RunLogLine = { ts: line.ts ?? new Date().toISOString(), channel: line.channel, phase: line.phase, message: line.message, seq: log.next++ }
  log.lines.push(entry)
  if (log.lines.length > RUN_LOG_CAP) log.lines.splice(0, log.lines.length - RUN_LOG_CAP)
  schedule(runId, log)
  return entry
}

/** The live lines of an active run in this process, or null when it has none. */
export function liveRunLog(runId: string): RunLogLine[] | null {
  const log = live.get(runId)
  return log ? [...log.lines] : null
}

/**
 * Stop following a run and return its lines for the terminal write (finalizeRun). Waits for a
 * flush in progress, so it cannot land after the terminal write.
 */
export async function closeRunLog(runId: string): Promise<RunLogLine[]> {
  const log = live.get(runId)
  if (!log) return []
  if (log.timer) clearTimeout(log.timer)
  log.timer = null
  if (log.flushing) await log.flushing
  live.delete(runId)
  return log.lines
}

/** Give stored lines their `seq` (old rows have none: their index), then apply `after` / `tail`. */
export function sliceRunLog(lines: RunLogLine[], opts: { after?: number; tail?: number } = {}): RunLogLine[] {
  let out = lines.map((l, i) => (l.seq === undefined ? { ...l, seq: i } : l))
  if (opts.after !== undefined) out = out.filter((l) => (l.seq ?? 0) > opts.after!)
  if (opts.tail !== undefined) out = out.slice(Math.max(0, out.length - opts.tail))
  return out
}
