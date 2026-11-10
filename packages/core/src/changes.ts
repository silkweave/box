// The in-process change bus behind the dashboard's live-refresh feed. Write paths emit a scope
// string when they commit ("table:content", "docs:initiatives", "config:schedules.json"); the
// server's `changes` tRPC subscription fans the events out to connected dashboard clients over SSE,
// which invalidate their matching data stores. Two producers feed it:
//
//   - precise, after commit: the record layer (model.ts) and the database write paths emit
//     per-table events for every write through the Box - web UI, MCP tools, REST, cron ingests;
//   - coarse, watched: the server's fs watcher on the tenant `data/` dir emits docs/config events
//     for OUT-of-process file edits (a local Claude session editing markdown, an editor).
//
// Writes made outside the Box (an administrator's psql session) raise no event.
//
// Events are invalidation hints only - no payloads, no row data. Still, a scope says where activity
// happens, so the feed hands each subscriber only what it may read (change-access.ts).

import { afterCommit } from './warehouse/executor.js'

export interface ChangeEvent {
  /** Monotonic per-process sequence (resets on restart; the hello event carries the boot id). */
  seq: number
  /** ISO-8601 emit time. */
  ts: string
  /** What changed: `table:<name>`, `docs:<section>` or `config:<file>`. */
  scope: string
  /** Optional refinement, e.g. the instance-relative file path for docs/config events. */
  detail: string | null
  /**
   * Server-side only, never sent to a client: the owning areas of the rows a change to a shared
   * core table touched (the writer's own record of them), so the feed delivers it only to readers
   * of those areas (change-access.ts). A shared-table change without them goes to admins only.
   */
  areas?: readonly string[]
}

type Listener = (ev: ChangeEvent) => void

let seq = 0
const listeners = new Set<Listener>()

/** Emit a change event to every subscriber. Never throws (a bad listener can't break a write).
 *  Inside a database transaction the event waits for the outermost commit; a rollback drops it. */
export function emitChange(scope: string, detail?: string): void {
  afterCommit(() => publish(scope, detail ?? null))
}

/**
 * Emit a change to a shared core table (signals, points, snapshots, runs) with the owning areas of
 * the rows it touched. An empty list emits nothing (no row changed).
 */
export function emitAreaChange(scope: string, areas: Iterable<string>, detail?: string): void {
  const list = [...new Set(areas)].sort()
  if (list.length === 0) return
  afterCommit(() => publish(scope, detail ?? null, list))
}

function publish(scope: string, detail: string | null, areas?: readonly string[]): void {
  const ev: ChangeEvent = { seq: ++seq, ts: new Date().toISOString(), scope, detail, ...(areas ? { areas } : {}) }
  for (const l of listeners) {
    try {
      l(ev)
    } catch {
      /* subscriber errors never propagate into the write path */
    }
  }
}

/** Subscribe to change events; returns the unsubscribe function. */
export function onChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
