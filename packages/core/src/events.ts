// The events spine - EVERY normalized domain event is recorded here durably, idempotently, before
// any policy (alert rules, notifications, engagement automation) looks at it. `recordEvent()` is the
// freshness gate: a duplicate insert means "already processed, never react twice". Everything
// downstream is either a read-only query over this table (digests, traction, the Inbox) or an
// in-process `onEvent` subscriber that only ever sees FRESH events.
//
// This is core, not a feature: Data Sync's pulls, content publishing, relay handlers and the run
// funnel all emit into it, and automation's triggers are one subscriber among several.
//
// The freshness-gate insert stays raw (INSERT … ON CONFLICT DO NOTHING … RETURNING is the
// idempotency semantics the record layer's partial upsert must not replace); plain row reads go
// through the record layer (warehouse/model.ts + the EVENTS spec). Aggregate queries stay raw.
// Raw writes stamp their own UTC-naive timestamps (never SQL now(), which is local wall time).

import { AsyncLocalStorage } from 'node:async_hooks'
import { ensureSchema, withRead, withWrite } from './warehouse/db.js'
import { readRecords, toNaiveUtc } from './warehouse/model.js'
import { EVENTS } from './warehouse/core-models.js'

/** One event as producers hand it in. */
export interface EventInput {
  /** Namespaced kind, e.g. 'reddit.inbox', 'run.error', 'signal.increase', 'content.published'. */
  kind: string
  /** Stable per-event key for dedup (Reddit fullname, `${action_id}:${date}`, a piece id, …). */
  dedup_key: string
  /** ISO timestamp of when the event actually happened. */
  event_at?: string
  /** Flat string fields; alert rules template them as `{field}`. */
  fields: Record<string, string>
  /** Where the event arrived from: push:x | push:github | poll:reddit | funnel | content | … */
  source?: string
  /** Who acted: @handle, u/name, GitHub login. '' for actor-less kinds (run.error, signal.*). */
  actor?: string
  /** What was acted ON (post id, repo, thread, piece) - the traction grouping key. '' when none. */
  subject?: string
  /** Permalink for the event, when one exists (also mirrored in fields for templates). */
  url?: string
}

/** A recorded event row (mirrors the `events` table). */
export interface EventRecord {
  id: string
  kind: string
  dedup_key: string
  source: string
  actor: string
  subject: string
  url: string
  fields: Record<string, string>
  event_at: string | null
  received_at: string
}

/** UTC-naive "now" for raw writes - the same stamp convention the record layer uses. */
const utcNow = (): string => toNaiveUtc(new Date().toISOString())

// --- event chain depth ---------------------------------------------------------------------------
// A run that an event trigger started can emit events of its own, which can fire triggers again.
// The automation dispatcher runs such work inside withEventDepth(depth + 1), and recordEvent
// stamps that depth on every event recorded inside it as `fields.depth` (unless the producer set
// one), so a chain of triggers stops at its max depth instead of looping. Work outside any chain
// (a timed pull, a person's request) records no depth, which reads as 0.

const chain = new AsyncLocalStorage<{ depth: number }>()

/** Run `work` as part of an event chain: events recorded inside carry `fields.depth = depth`. */
export function withEventDepth<T>(depth: number, work: () => T): T {
  return chain.run({ depth }, work)
}

/** Run `work` outside any event chain (long-lived timers must not inherit the depth of whoever armed them). */
export function outsideEventChain<T>(work: () => T): T {
  return chain.exit(work)
}

/** The event chain depth of the current async context, or undefined outside a chain. */
export function currentEventDepth(): number | undefined {
  return chain.getStore()?.depth
}

/** An event's chain depth: its `fields.depth`, 0 when absent or not a number. */
export function eventDepth(event: Pick<EventInput, 'fields'>): number {
  const n = Number(event.fields?.['depth'])
  return Number.isInteger(n) && n > 0 ? n : 0
}

// --- subscribers ---------------------------------------------------------------------------------
// Best-effort, in-process, fresh-only. A listener that throws is logged and never propagates into
// the producer (the same contract emitChange has). There is no outbox and no replay across
// restarts: a subscriber that needs at-least-once semantics reads the table instead.

export type EventListener = (event: EventInput) => void | Promise<void>

const listeners = new Set<EventListener>()

/** Subscribe to FRESH events. Returns the unsubscribe. Register from a server module's onModuleInit. */
export function onEvent(listener: EventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function fanOut(event: EventInput): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(event)
    } catch (err) {
      console.error(`[events] listener failed for ${event.kind}:${event.dedup_key}: ${String((err as Error)?.message ?? err)}`)
    }
  }
}

/**
 * Record one event, idempotently. Returns true when the event is FRESH (actually inserted) and
 * false when it was already stored. Subscribers run only on the fresh path, after the row is
 * committed, and are awaited before this resolves so a caller that chains on "fresh" sees their
 * side effects settled.
 */
export async function recordEvent(input: EventInput): Promise<boolean> {
  const depth = currentEventDepth()
  const event: EventInput =
    depth !== undefined && input.fields?.['depth'] === undefined ? { ...input, fields: { ...input.fields, depth: String(depth) } } : input
  await ensureSchema()
  const fresh = await withWrite(async (conn) => {
    const res = await conn.runAndReadAll(
      `INSERT INTO events (id, kind, dedup_key, source, actor, subject, url, fields, event_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::JSON, ?::TIMESTAMP, ?::TIMESTAMP)
       ON CONFLICT (kind, dedup_key) DO NOTHING
       RETURNING id`,
      [
        `${event.kind}:${event.dedup_key}`,
        event.kind,
        event.dedup_key,
        event.source ?? '',
        event.actor ?? '',
        event.subject ?? '',
        event.url ?? event.fields.url ?? event.fields.permalink ?? '',
        JSON.stringify(event.fields ?? {}),
        event.event_at ? toNaiveUtc(event.event_at) : null,
        utcNow(),
      ],
    )
    return (res.getRowObjectsJson() as unknown[]).length > 0
  })
  if (fresh) await fanOut(event)
  return fresh
}

/** Recent events of the given kinds (newest first) - the digest + Inbox read side. */
export async function listEvents(kinds: string[], sinceIso: string, limit = 500): Promise<EventRecord[]> {
  if (kinds.length === 0) return []
  const placeholders = kinds.map(() => '?').join(', ')
  return readRecords<EventRecord>(EVENTS, {
    where: `kind IN (${placeholders}) AND COALESCE(event_at, received_at) >= ?::TIMESTAMP`,
    params: [...kinds, toNaiveUtc(sinceIso)],
    orderBy: `COALESCE(event_at, received_at) DESC LIMIT ${Number(limit)}`,
  })
}

/** The kinds recorded since `sinceIso`, most frequent first - what an event trigger can listen for. */
export async function recentEventKinds(sinceIso: string, limit = 200): Promise<{ kind: string; count: number }[]> {
  await ensureSchema()
  const rows = await withRead<{ kind: string; n: unknown }>(
    `SELECT kind, count(*) AS n FROM events
      WHERE COALESCE(event_at, received_at) >= ?::TIMESTAMP
      GROUP BY kind ORDER BY n DESC, kind LIMIT ${Number(limit)}`,
    [toNaiveUtc(sinceIso)],
  )
  return rows.map((r) => ({ kind: r.kind, count: Number(r.n) }))
}

/**
 * Events-per-UTC-day for the given kinds, ascending - the event-derived-signals read side
 * (e.g. the `x.engagement` signal). Days with no events are absent; callers zero-fill.
 */
export async function dailyKindCounts(kinds: string[]): Promise<{ date: string; value: number }[]> {
  if (kinds.length === 0) return []
  await ensureSchema()
  const placeholders = kinds.map(() => '?').join(', ')
  const rows = await withRead<{ date: string; value: unknown }>(
    `SELECT CAST(CAST(COALESCE(event_at, received_at) AS DATE) AS VARCHAR) AS date, count(*) AS value
       FROM events
      WHERE kind IN (${placeholders})
      GROUP BY 1
      ORDER BY 1`,
    kinds,
  )
  return rows.map((r) => ({ date: r.date, value: Number(r.value) }))
}

/** Per-subject engagement counts over a trailing window - the traction-detection read side. */
export interface SubjectActivity {
  subject: string
  total: number
  /** Per-kind counts within the window, e.g. { 'x.like': 12, 'x.reply': 3 }. */
  byKind: Record<string, number>
  /** Latest event for the subject in the window - carries a representative url + fields. */
  latest: EventRecord
}

export async function subjectActivity(kinds: string[], sinceIso: string): Promise<SubjectActivity[]> {
  if (kinds.length === 0) return []
  await ensureSchema()
  const placeholders = kinds.map(() => '?').join(', ')
  const rows = await withRead<Record<string, unknown>>(
    `SELECT subject, kind, count(*) AS n
       FROM events
      WHERE subject <> '' AND kind IN (${placeholders}) AND COALESCE(event_at, received_at) >= ?::TIMESTAMP
      GROUP BY subject, kind`,
    [...kinds, toNaiveUtc(sinceIso)],
  )
  const bySubject = new Map<string, { total: number; byKind: Record<string, number> }>()
  for (const r of rows) {
    const subject = String(r.subject)
    const entry = bySubject.get(subject) ?? { total: 0, byKind: {} }
    const n = Number(r.n)
    entry.total += n
    entry.byKind[String(r.kind)] = n
    bySubject.set(subject, entry)
  }
  const out: SubjectActivity[] = []
  for (const [subject, { total, byKind }] of bySubject) {
    const latest = await readRecords<EventRecord>(EVENTS, {
      where: 'subject = ?',
      params: [subject],
      orderBy: 'COALESCE(event_at, received_at) DESC LIMIT 1',
    })
    if (latest[0]) out.push({ subject, total, byKind, latest: latest[0] })
  }
  return out.sort((a, b) => b.total - a.total)
}
