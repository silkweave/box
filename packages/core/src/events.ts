// The events spine - EVERY normalized domain event is recorded here durably, idempotently, before
// any policy (alert rules, notifications, feature automation) looks at it. `recordEvent()` is the
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
// Timestamps are instants (timestamptz); writes pass ISO-8601 text.

import { asSystem, canReachAreas } from './request-context.js'
import { emitAreaChange } from './changes.js'
import { isStoredArea } from './auth/owning-area.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { withWrite } from './warehouse/db.js'
import { db } from './warehouse/core-db.js'
import { anyOf, json, sql } from './warehouse/kysely.js'
import type { ExpressionBuilder } from './warehouse/kysely.js'
import type { CoreDb } from './warehouse/core-models.js'
import { toInstant } from './warehouse/model.js'

/** One event as producers hand it in. */
export interface EventInput {
  /** Namespaced kind, e.g. 'reddit.inbox', 'run.error', 'signal.increase', 'goal.met'. */
  kind: string
  /** Stable per-event key for dedup (Reddit fullname, `${action_id}:${date}`, a record id, …). */
  dedup_key: string
  /** ISO timestamp of when the event actually happened. */
  event_at?: string
  /** Flat string fields; alert rules template them as `{field}`. */
  fields: Record<string, string>
  /** Where the event arrived from: push:x | push:github | poll:reddit | funnel | content | … */
  source?: string
  /** Who acted: @handle, u/name, GitHub login. '' for actor-less kinds (run.error, signal.*). */
  actor?: string
  /** What was acted ON (post id, repo, thread, record) - the traction grouping key. '' when none. */
  subject?: string
  /** Permalink for the event, when one exists (also mirrored in fields for templates). */
  url?: string
  /**
   * Every area a reader needs (PERMISSIONS 8.3), from the data: the producing feature for its own
   * records, a signal's area for `signal.*`, the union of the inputs for a digest. Never empty;
   * `admin` when nothing classifies it.
   */
  areas: readonly string[]
}

/**
 * The validated area list of an event: non-empty, each an owning area (an installed feature,
 * `signals`, `ops` or `admin`), stored sorted and unique.
 */
export function eventAreas(areas: readonly string[] | undefined): string[] {
  const out = [...new Set((areas ?? []).map((a) => (typeof a === 'string' ? a.trim() : '')))]
  if (!out.length || out.some((a) => !a)) throw new Error('an event needs a non-empty list of areas (PERMISSIONS 8.3); use admin when nothing classifies it')
  const unknown = out.filter((a) => !isStoredArea(a))
  if (unknown.length) throw new Error(`event areas ${unknown.join(', ')} are not owning areas (an installed feature, signals, ops or admin)`)
  return out.sort()
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
  /** Every area a reader needs (EventInput.areas). */
  areas: string[]
}

/** UTC-naive "now" for raw writes - the same stamp convention the record layer uses. */
const CORE = { reach: 'core' } as const

/** `coalesce(event_at, received_at)`: when the event happened, else when it arrived. */
const happenedAt = (eb: ExpressionBuilder<CoreDb, 'events'>) => eb.fn.coalesce('event_at', 'received_at')

/** A row limit, validated as the record layer does. */
function rowLimit(limit: number): number {
  const n = Math.trunc(Number(limit))
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid limit ${n}`)
  return n
}

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
      // Subscribers are derivations and runners after an authorized write: named system work,
      // whoever recorded the event (request-context.ts).
      await asSystem(`events: ${event.kind}`, () => listener(event))
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
  const fresh = await withWrite(async () => {
    const rows = await db.insertInto('events')
      .values({
        id: `${event.kind}:${event.dedup_key}`,
        kind: event.kind,
        dedup_key: event.dedup_key,
        source: event.source ?? '',
        actor: event.actor ?? '',
        subject: event.subject ?? '',
        url: event.url ?? event.fields.url ?? event.fields.permalink ?? '',
        fields: json(event.fields ?? {}),
        event_at: event.event_at ? toInstant(event.event_at) : null,
        received_at: new Date().toISOString(),
        areas: eventAreas(event.areas),
      })
      .onConflict((oc) => oc.columns(['kind', 'dedup_key']).doNothing())
      .returning('areas')
      .execute()
    // A fresh row only, with the areas as stored: the feed delivers it to readers of all of them.
    if (rows[0]) emitAreaChange('table:events', rows[0].areas)
    return rows.length > 0
  }, CORE)
  if (fresh) await fanOut(event)
  return fresh
}

/**
 * Recent events of the given kinds (newest first) - the digest + Inbox read side.
 *
 * Reads by area (W8 R3, PERMISSIONS 8.3): a request caller sees only events whose every area it can
 * read (row security applies the same predicate at the database); system work sees all. A caller
 * that summarizes events into a shared output (a derived signal, a digest, a detector) reads as
 * named system work after its own admission, so one reader's view never becomes everyone's result.
 */
export async function listEvents(kinds: string[], sinceIso: string, limit = 500): Promise<EventRecord[]> {
  if (kinds.length === 0) return []
  const rows = (await db.selectFrom('events').selectAll()
    .where('kind', '=', anyOf(kinds))
    .where((eb) => eb(happenedAt(eb), '>=', toInstant(sinceIso)))
    .orderBy(happenedAt, 'desc')
    .limit(rowLimit(limit))
    .execute()) as EventRecord[]
  return rows.filter((e) => canReachAreas(e.areas, 'read'))
}

/**
 * The kinds recorded since `sinceIso`, most frequent first - what an event trigger can listen for.
 * Counts only the events the caller can read (row security; listEvents).
 */
export async function recentEventKinds(sinceIso: string, limit = 200): Promise<{ kind: string; count: number }[]> {
  const rows = await db.selectFrom('events')
    .select(['kind', (eb) => eb.fn.countAll<number>().as('n')])
    .where((eb) => eb(happenedAt(eb), '>=', toInstant(sinceIso)))
    .groupBy('kind').orderBy('n', 'desc').orderBy('kind')
    .limit(rowLimit(limit))
    .execute()
  return rows.map((r) => ({ kind: r.kind, count: Number(r.n) }))
}

/**
 * Events-per-UTC-day for the given kinds, ascending - the event-derived-signals read side
 * (e.g. the `x.engagement` signal). Days with no events are absent; callers zero-fill. Counts only
 * the events the caller can read (row security): a deriver reads as named system work (listEvents).
 */
export async function dailyKindCounts(kinds: string[]): Promise<{ date: string; value: number }[]> {
  if (kinds.length === 0) return []
  // Sessions run in UTC, so the date of an instant is its UTC day.
  const rows = await db.selectFrom('events')
    // Raw sql: the ::date cast of the event instant.
    .select([sql<string>`coalesce(event_at, received_at)::date`.as('date'), (eb) => eb.fn.countAll<number>().as('value')])
    .where('kind', '=', anyOf(kinds))
    .groupBy('date').orderBy('date')
    .execute()
  return rows.map((r) => ({ date: r.date, value: Number(r.value) }))
}

/** Per-subject engagement counts over a trailing window - the traction-detection read side. */
export interface SubjectActivity {
  subject: string
  total: number
  /** Per-kind counts within the window, e.g. { 'x.like': 12, 'x.reply': 3 }. */
  byKind: Record<string, number>
  /** Every area of the counted events, sorted: a summary's reader needs them all (8.3). */
  areas: string[]
  /** Latest counted event for the subject (of the given kinds, in the window) - a representative url + fields. */
  latest: EventRecord
}

/**
 * Activity per subject for the given kinds since `sinceIso`, busiest first. Counts only the events
 * the caller can read (row security; listEvents for system callers).
 */
export async function subjectActivity(kinds: string[], sinceIso: string): Promise<SubjectActivity[]> {
  if (kinds.length === 0) return []
  const since = toInstant(sinceIso)
  // One statement, one snapshot (BOX-Review d7f5f4e finding 5): the counts, their areas and each
  // subject's newest counted event come from the same rows, so the representative event's areas are
  // always among the summary's. Events are append-only, so reading it by id afterwards returns the
  // same row (or none, if pruned meanwhile: that subject is skipped). The window's rows are few
  // (a trailing window of the given kinds), and this shape runs on both engines.
  const rows = await db.selectFrom('events').select(['id', 'subject', 'kind', 'areas'])
    .where('subject', '<>', '').where('kind', '=', anyOf(kinds))
    .where((eb) => eb(happenedAt(eb), '>=', since))
    .orderBy('subject').orderBy(happenedAt, 'desc').orderBy('id')
    .execute()
  const bySubject = new Map<string, { total: number; byKind: Record<string, number>; areas: Set<string>; latestId: string }>()
  for (const r of rows) {
    // Ordered newest first per subject: the first row of a subject is its representative.
    const entry = bySubject.get(r.subject) ?? { total: 0, byKind: {}, areas: new Set<string>(), latestId: r.id }
    entry.total += 1
    entry.byKind[r.kind] = (entry.byKind[r.kind] ?? 0) + 1
    for (const a of r.areas ?? []) entry.areas.add(a)
    bySubject.set(r.subject, entry)
  }
  if (bySubject.size === 0) return []
  const latest = new Map<string, EventRecord>()
  const picked = (await db.selectFrom('events').selectAll().where('id', '=', anyOf([...bySubject.values()].map((e) => e.latestId))).execute()) as EventRecord[]
  for (const e of picked) latest.set(e.subject, e)
  const out: SubjectActivity[] = []
  for (const [subject, { total, byKind, areas }] of bySubject) {
    const last = latest.get(subject)
    if (last) out.push({ subject, total, byKind, areas: [...areas].sort(), latest: last })
  }
  return out.sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject))
}
