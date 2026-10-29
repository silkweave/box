import type {
  SignalAccumulation,
  SignalDirection,
  SignalInterval,
  SignalPointsPayload,
  SignalSource,
  SignalsData,
} from '../../types.ts'
import { registerStoreReloads } from '../../lib/changeFeed.ts'
import { createDataStore } from '../../lib/dataStore.ts'
import { trpc } from '../../lib/trpc.ts'
import { getActiveUserId } from '../../lib/useActiveUser.ts'

/** The active user as the mutation's `actor` audit stamp (created_by/updated_by server-side). */
const actor = (): string | undefined => getActiveUserId() ?? undefined

// One shared store (see dataStore.ts) so every signals route (layout, grid, detail) shares ONE
// fetch and re-renders after a mutation (owner/definition edits). Navigating between the overview,
// a channel and a signal detail reads the cache synchronously - no repeated round-trips.
const store = createDataStore<SignalsData>(() => trpc.signalsData.query({}).then((d) => d as unknown as SignalsData))
registerStoreReloads(
  ['table:signals', 'table:signal_points', 'table:snapshots', 'docs:signals'],
  store,
)

// The same payload with archived signals in it, for a reader that resolves a signal it already
// references (a goal's or a milestone's): archiving hides a signal from pickers and the Signals page,
// never from what points at it. Its own store, so the pickers stay on the default (live) list.
const withArchived = createDataStore<SignalsData>(() =>
  trpc.signalsData.query({ include_archived: true }).then((d) => d as unknown as SignalsData),
)
registerStoreReloads(['table:signals', 'table:signal_points', 'table:snapshots', 'docs:signals'], withArchived)

/** Force a refetch (after an owner edit or a fresh ingest). */
export const reloadSignals = async (): Promise<SignalsData> => {
  const [live] = await Promise.all([store.reload(), withArchived.peek() !== null ? withArchived.reload() : null])
  return live
}

/** Every signal, archived ones included - for resolving a signal something already references, and
 *  for the Signals page (which filters archived ones out unless "Show archived" is on). */
export function useSignalsDataWithArchived(enabled = true): { data: SignalsData | null; error: string | null } {
  return withArchived.useData(enabled)
}

/**
 * Set a signal' owner: a users.id, or null for explicitly unowned (brand-level). Writes
 * the signal-owner settings AND (server-side) the signal definition when one exists.
 */
export async function setSignalOwner(signalId: string, owner: string | null): Promise<void> {
  await trpc.signalsOwnersSave.mutate(
    owner === null
      ? { scope: 'signal', key: signalId, unowned: true, actor: actor() }
      : { scope: 'signal', key: signalId, owner, actor: actor() },
  )
  await reloadSignals()
}

/** Fields editable from the dashboard (subset of the server's signal-upsert input). */
export interface SignalUpsert {
  id: string
  label?: string
  signal_group?: string
  /** '' clears it (the server's flattened-scalar convention). */
  unit?: string
  channel?: string
  /** Kept when editing an existing signal so a hand-registered derived straggler stays derived. */
  source?: SignalSource
  interval?: SignalInterval
  accumulation?: SignalAccumulation
  direction?: SignalDirection
  /** '' clears it (falls back to the ownership chain). */
  owner?: string
  description?: string
  /** Signal ids this one is DRIVEN BY (the circuit board's edges). The server refuses unknown ids
   *  and cycles with the reason - surface that message, never swallow it. `[]` clears every edge. */
  depends_on?: string[]
  /** The provider binding. Both are required together; '' on EITHER clears both (unbind - the
   *  points stay, they simply stop refreshing). */
  data_source_id?: string
  measure_key?: string
  /** Make this a formula signal (points computed on read; depends_on follows its ids). '' clears
   *  it. The server refuses a formula that does not parse, names an unknown signal or would cycle,
   *  with the reason (and the character position for syntax errors). */
  formula?: string
  /** Replaces the threshold levels; [] clears. */
  thresholds?: number[]
}

/** Create or update a signal definition (admin), then reload. */
export async function upsertSignal(input: SignalUpsert): Promise<void> {
  await trpc.signalsUpsert.mutate({ ...input, actor: actor() })
  await reloadSignals()
}

/** Delete a signal definition (admin; points survive), then reload. Returns the server's report. */
export async function deleteSignal(id: string): Promise<{ warnings: string[] }> {
  const report = (await trpc.signalsDelete.mutate({ id, actor: actor() })) as unknown as { warnings: string[] }
  await reloadSignals()
  return report
}

export function useSignalsData(): { data: SignalsData | null; error: string | null } {
  return store.useData()
}

/** Archive (true) or unarchive (false) a signal (admin), then reload both lists. Archiving only
 *  hides it from pickers and the Signals page; its points and every reader stay as they were. */
export async function setSignalArchivedState(id: string, archived: boolean): Promise<void> {
  if (archived) await trpc.signalsArchive.mutate({ id, actor: actor() })
  else await trpc.signalsUnarchive.mutate({ id, actor: actor() })
  await Promise.all([store.reload(), withArchived.reload()])
}

// --- points (phase B2) ---------------------------------------------------------------------------
// Point entry is operational data entry (any authenticated user, audit via `actor`), not admin
// configuration. Each mutation returns the fresh points payload for the editor AND reloads the
// shared signals store so the chart/cards pick the merged history up in the same round-trip.

/** A signal's manual points + shadow state (the detail page's editor read). */
export async function fetchSignalPoints(signalId: string): Promise<SignalPointsPayload> {
  return (await trpc.signalsPoints.mutate({ signal_id: signalId })) as unknown as SignalPointsPayload
}

/** Upsert one manual point at floor(at, interval). '' note clears it. */
export async function saveSignalPoint(
  signalId: string,
  at: string,
  value: number,
  note?: string,
): Promise<SignalPointsPayload> {
  const res = await trpc.signalsPointSet.mutate({
    signal_id: signalId,
    at,
    value,
    ...(note !== undefined ? { note } : {}),
    actor: actor(),
  })
  await reloadSignals()
  return res as unknown as SignalPointsPayload
}

/** Remove one manual point (any time inside its bucket). */
export async function removeSignalPoint(signalId: string, at: string): Promise<SignalPointsPayload> {
  const res = await trpc.signalsPointDelete.mutate({ signal_id: signalId, at, actor: actor() })
  await reloadSignals()
  return res as unknown as SignalPointsPayload
}

/** The bulk manual path - a pasted batch of {at, value, note?} rows in one call. */
export async function saveSignalPoints(
  signalId: string,
  points: { at: string; value: number; note?: string }[],
): Promise<SignalPointsPayload> {
  const res = await trpc.signalsPointsSet.mutate({
    signal_id: signalId,
    points: JSON.stringify(points),
    actor: actor(),
  })
  await reloadSignals()
  return res as unknown as SignalPointsPayload
}
