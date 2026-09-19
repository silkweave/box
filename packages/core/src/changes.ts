// The in-process change bus behind the dashboard's live-refresh feed. Write paths emit a scope
// string when they commit ("table:content", "docs:initiatives", "config:schedules.json",
// "warehouse"); the server's `changes` tRPC subscription fans the events out to connected dashboard
// clients over SSE, which invalidate their matching data stores. Two producers feed it:
//
//   • precise, immediate: the warehouse record layer (model.ts) + the signal write helpers (db.ts)
//     emit per-table events for every in-process write - web UI, MCP tools, REST, cron ingests all
//     funnel through the one server process;
//   • coarse, watched: the server's fs watcher on the tenant `data/` dir emits docs/config/warehouse
//     events for OUT-of-process edits (a local Claude session editing markdown, an editor, an
//     external DuckDB writer). `lastWarehouseWriteAt` lets the watcher skip data.db events the
//     in-process producer already covered.
//
// Events are invalidation hints only - no payloads, no row data - so fanning them out to any
// authenticated principal leaks nothing beyond "something in <scope> changed".

export interface ChangeEvent {
  /** Monotonic per-process sequence (resets on restart; the hello event carries the boot id). */
  seq: number
  /** ISO-8601 emit time. */
  ts: string
  /** What changed: `table:<name>`, `docs:<section>`, `config:<file>`, or the generic `warehouse`. */
  scope: string
  /** Optional refinement, e.g. the instance-relative file path for docs/config events. */
  detail: string | null
}

type Listener = (ev: ChangeEvent) => void

let seq = 0
const listeners = new Set<Listener>()

/** Emit a change event to every subscriber. Never throws (a bad listener can't break a write). */
export function emitChange(scope: string, detail?: string): void {
  const ev: ChangeEvent = { seq: ++seq, ts: new Date().toISOString(), scope, detail: detail ?? null }
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

// --- watcher suppression --------------------------------------------------------------------------
// withWrite stamps this on every in-process warehouse write; the fs watcher skips data.db* events
// within a short window of it, so the precise table events aren't doubled by a generic `warehouse`
// one. A concurrent external write inside the window is missed - rare, and the next event corrects.

let warehouseWriteAt = 0

export function markWarehouseWrite(): void {
  warehouseWriteAt = Date.now()
}

export function lastWarehouseWriteAt(): number {
  return warehouseWriteAt
}
