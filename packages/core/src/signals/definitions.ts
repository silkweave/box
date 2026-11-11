// Read/write the signal registry (`signals`) - the durable identity + curation layer over the
// signal's history in `signal_points` (see signals/types.ts for the model). Row↔domain plumbing
// comes from the record layer (warehouse/model.ts) driven by the SIGNAL_DEFINITIONS spec; this
// module keeps only the domain semantics: create-defaults, depends_on hygiene (mirrors
// planning/state.ts normalizeBlockedBy), the rename/delete cascades, and auto-registration.
//
// Auto-registration is the reconciliation strategy for the derived world: the derived signal set
// is dynamic (account-scoped github@<id> channels, npm top-N rotation, a feature's per-channel signals),
// so a one-shot seed would rot. Instead every signal-row writer calls autoRegisterDefinitions()
// after persisting - it inserts a definition for any signal id that lacks one and NEVER overwrites
// an existing row (human curation always wins over the deriver's denormalized strings), and it
// never deletes (a definition whose signal disappears stays - curation is durable; cleanup is a
// human decision via signal-delete).

import { emitAreaChange } from '../changes.js'
import { withWrite } from '../warehouse/db.js'
import { db } from '../warehouse/core-db.js'
import { anyOf, json, now } from '../warehouse/kysely.js'
import { pointWrite, type SignalRow } from './write.js'
import { coreCommand } from '../warehouse/core-command.js'
import { changedColumns, readRecord, upsertRecord } from '../warehouse/model.js'
import { SIGNAL_DEFINITIONS } from './models.js'
import { findProvider, findProviderTracker } from './sources/registry.js'
import { requireTracker, validateTrackerParams } from './trackers.js'
import { readDataSource } from './sources/state.js'
import { assertKnownActor, assertKnownUser } from '../users/state.js'
import { readSignalOwnersFile, resolveSignalOwner, writeSignalOwnersFile } from './owners.js'
import { pruneBoardRef, renameBoardRef } from './board-kinds.js'
import { signalHooks, signalReferences } from './hooks.js'
import { ADMIN_AREA, storedArea, trackerArea } from '../auth/owning-area.js'
import { asSystem, canReachAreas, requireReachArea } from '../request-context.js'
import { FormulaError, formulaRefs, formulaRefsOf, parseFormula, renameFormulaRef } from './formula.js'
import {
  MANUAL_SIGNAL_CHANNEL,
  type SignalDefinition,
  type SignalDefinitionInput,
  type SignalSource,
} from './types.js'

// One shared namespace with signals.signal_id: plain slugs for curated signals ('mrr'), dots as
// the derived world's convention ('github.stars.acme'), '@' and '/' for account- and
// package-scoped ids ('github@bob.followers', 'npm.pkg.@acme/core'). Dots are a convention,
// not a syntax, so the charset is permissive and structure is deliberately NOT enforced.
const SIGNAL_ID = /^[a-z0-9][a-z0-9._@/-]*$/

// --- reads ---------------------------------------------------------------------------------------

// JSON columns can read back null on rows written outside the record layer; hand callers an array.
const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [])
const params = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string>
    : {}
const norm = (d: SignalDefinition): SignalDefinition => ({
  ...d,
  depends_on: list(d.depends_on),
  tracker_params: params(d.tracker_params),
  formula: d.formula ?? null,
  thresholds: numbers(d.thresholds),
  archived_at: d.archived_at ?? null,
})

/** Bound to a Box tracker: a tracker key and no data source. */
export const isBoxTrackerSignal = (d: Pick<SignalDefinition, 'tracker_key' | 'data_source_id'>): boolean =>
  Boolean(d.tracker_key) && !d.data_source_id

/**
 * Every area a reader of `def`'s values needs: its own area plus, for a formula, every input's,
 * transitively (PERMISSIONS 8.3: labels follow every sensitive input). An input that no longer
 * exists, and a formula that does not parse, count as `admin`; cycles end at the first repeat. `byId` holds every definition.
 */
export function signalAreaClosure(
  def: Pick<SignalDefinition, 'id' | 'area' | 'formula'>,
  byId: ReadonlyMap<string, Pick<SignalDefinition, 'id' | 'area' | 'formula'>>,
): string[] {
  const out = new Set<string>()
  const seen = new Set<string>()
  const stack = [def]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.add(d.area || ADMIN_AREA)
    if (!d.formula) continue
    const refs = formulaRefsOf(d.formula)
    // A stored formula that does not parse has an unknown input set: nothing classifies it.
    if (refs.length === 0) out.add(ADMIN_AREA)
    for (const ref of refs) {
      const input = byId.get(ref)
      if (input) stack.push(input)
      else out.add(ADMIN_AREA)
    }
  }
  return [...out].sort()
}

/** The binding (source, provider or Box tracker, formula and what it depends on, the owning area) is
 *  enforced as a whole, so an update sends it whole when any part changes (changedColumns). */
const BINDING_GROUPS = [['source', 'data_source_id', 'tracker_key', 'tracker_params', 'formula', 'depends_on', 'area', 'channel']]

/** Thresholds as stored: finite, ascending, unique. Anything else is refused, not dropped. */
function normalizeThresholds(id: string, raw: unknown[]): number[] {
  const bad = raw.filter((x) => typeof x !== 'number' || !Number.isFinite(x))
  if (bad.length > 0) throw new Error(`signal ${id}: thresholds must be finite numbers`)
  return [...new Set(raw as number[])].sort((a, b) => a - b)
}

/**
 * Signal definitions, sorted by `sort` then id. Archived ones are included unless
 * `includeArchived: false`: internal reads (derives, formulas, goals, milestones) must see every
 * signal; the list endpoints behind the pickers and the Signals page pass `false` by default.
 */
export async function readSignalDefinitions(opts: { includeArchived?: boolean } = {}): Promise<SignalDefinition[]> {
  const all = readable(await readStoredDefinitions())
  return opts.includeArchived === false ? all.filter((d) => !d.archived_at) : all
}

/** Every definition the database lets this frame see (row security: its own area readable). */
async function readStoredDefinitions(): Promise<SignalDefinition[]> {
  return ((await db.selectFrom('signals').selectAll().orderBy('sort').orderBy('id').execute()) as SignalDefinition[]).map(norm)
}

/**
 * The definitions a reader may see (PERMISSIONS 8.3): every area of a signal's closure readable,
 * so a formula whose input is hidden is hidden too (the missing input counts as admin). `visible`
 * is what row security returned; system work sees everything.
 */
function readable(visible: SignalDefinition[]): SignalDefinition[] {
  const byId = new Map(visible.map((d) => [d.id, d]))
  return visible.filter((d) => canReachAreas(signalAreaClosure(d, byId), 'read'))
}

/**
 * Archive (or with `archived: false`, unarchive) a signal. Archiving only hides it from the lists
 * and pickers; its definition, points and every reference to it stay. Idempotent: archiving an
 * archived signal keeps the first stamp.
 */
export async function setSignalArchived(id: string, archived: boolean, actor?: string): Promise<SignalDefinition> {
  const prev = await readSignalDefinition(id)
  if (!prev) throw new Error(`signal ${id} not found`)
  if (Boolean(prev.archived_at) === archived) return prev
  // Only the stamp is sent: the record layer merges the rest from the row it locks, so an edit
  // committed since the read above is not written back over.
  const saved = await upsertRecord<SignalDefinition>(
    SIGNAL_DEFINITIONS,
    { id, archived_at: archived ? new Date().toISOString() : null, ...(actor ? { actor } : {}) },
    { mustExist: true },
  )
  return norm(saved)
}

/** One definition, or null when there is none or the frame may not read it (as readSignalDefinitions). */
export async function readSignalDefinition(id: string): Promise<SignalDefinition | null> {
  const d = await readRecord<SignalDefinition>(SIGNAL_DEFINITIONS, { id })
  if (!d) return null
  const def = norm(d)
  if (!def.formula) return canReachAreas([def.area], 'read') ? def : null
  return readable(await readStoredDefinitions()).find((x) => x.id === id) ?? null
}

// --- the dependency graph ------------------------------------------------------------------------

/** Every definition's `depends_on` edge list, as stored. */
async function readDependsEdges(): Promise<Map<string, string[]>> {
  const rows = await db.selectFrom('signals').select(['id', 'depends_on']).execute()
  return new Map(rows.map((r) => [r.id, Array.isArray(r.depends_on) ? (r.depends_on as string[]) : []]))
}

/** The owning areas of the given signals (system transactions: every area). */
async function areasOf(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  return (await db.selectFrom('signals').select('area').distinct().where('id', '=', anyOf(ids)).execute()).map((r) => r.area)
}

/** The `updated_at` stamp of a fixup that bypasses the upsert path; `updated_by` changes only when an actor is given. */
const stamp = (actor?: string) => ({ updated_at: now(), ...(actor != null ? { updated_by: actor } : {}) })

/** Persist one row's edge list (used by the rename/delete fixups, which bypass the upsert path). */
async function writeDependsOn(id: string, deps: string[], actor?: string): Promise<void> {
  await db.updateTable('signals')
    .set({ depends_on: json(deps), ...stamp(actor) })
    .where('id', '=', id)
    .execute()
}

/**
 * Clean a proposed `depends_on` list: trimmed, de-duplicated, self-reference dropped, every target
 * must exist, and the graph must stay acyclic. "MRR drives churn drives MRR" is never a true causal
 * claim, it is a data-entry mistake, and the circuit-board walk (phase B3) will follow these edges.
 */
async function normalizeDependsOn(id: string, raw: string[]): Promise<string[]> {
  const deps = [...new Set(raw.map((s) => s.trim()).filter(Boolean))].filter((d) => d !== id)
  if (deps.length === 0) return deps
  // Only signals the writer can read count as known (a hidden id reads as unknown); the cycle walk
  // needs every edge, hidden ones included, and names nothing it found there.
  const known = new Set((await readSignalDefinitions()).map((d) => d.id))
  const unknown = deps.filter((d) => !known.has(d))
  if (unknown.length > 0) throw new Error(`signal ${id}: depends_on references unknown signal(s) ${unknown.join(', ')}`)
  const edges = await asSystem('signals: dependency check', () => readDependsEdges())

  edges.set(id, deps)
  const seen = new Set<string>()
  const stack = [...deps]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === id) throw new Error(`signal ${id}: depends_on would create a dependency cycle`)
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(edges.get(cur) ?? []))
  }
  return deps
}

// --- writes --------------------------------------------------------------------------------------

interface Binding {
  data_source_id: string | null
  tracker_key: string | null
  tracker_params: Record<string, string>
}

/**
 * Validate a proposed binding. Three shapes, and why each rule exists:
 *
 *   • `data_source_id` + `tracker_key` - a PROVIDER tracker. The source and the provider's tracker
 *     must exist (refused with the valid list), and a `source: 'derived'` signal may never carry
 *     one: a deriver already owns its rows. Its `tracker_params` are always `{}`.
 *   • `tracker_key` alone - a BOX tracker from the trackers registry (signals/trackers.ts).
 *     Unknown keys are refused with the registered list, `tracker_params` are validated against
 *     the tracker's declared params, and the signal becomes `source: 'derived'` (the caller sets
 *     it): the tracker computes its live points.
 *   • neither - unbound. A `data_source_id` without a tracker is refused: the sync would find a
 *     subscriber it cannot resolve to a feed.
 *
 * Two signals binding the same tracker is deliberately ALLOWED - points are keyed per signal id.
 */
async function normalizeBinding(
  id: string,
  effectiveSource: SignalSource,
  next: { data_source_id: string | null; tracker_key: string | null; tracker_params: Record<string, unknown> },
): Promise<Binding> {
  const sourceId = next.data_source_id?.trim() || null
  const trackerKey = next.tracker_key?.trim() || null
  if (!sourceId && !trackerKey) return { data_source_id: null, tracker_key: null, tracker_params: {} }
  if (!trackerKey) {
    throw new Error(
      `signal ${id}: a data_source_id needs a tracker_key - a half-bound signal has a subscriber the sync cannot resolve`,
    )
  }
  if (!sourceId) {
    const tracker = requireTracker(trackerKey)
    return {
      data_source_id: null,
      tracker_key: trackerKey,
      tracker_params: await validateTrackerParams(tracker, next.tracker_params ?? {}, assertKnownUser),
    }
  }
  if (effectiveSource === 'derived') {
    throw new Error(
      `signal ${id} is a derived signal - its rows are owned by deriver code, so it cannot also have a provider writing its points. Create a manual signal for the connected signal instead.`,
    )
  }
  const source = await readDataSource(sourceId)
  if (!source) throw new Error(`signal ${id}: unknown data source "${sourceId}"`)
  const provider = findProvider(source.provider)
  if (!provider) {
    throw new Error(`signal ${id}: data source ${sourceId} names provider "${source.provider}", which is not registered in this build`)
  }
  if (!findProviderTracker(provider, trackerKey)) {
    throw new Error(
      `signal ${id}: provider ${provider.id} offers no tracker "${trackerKey}" - valid: ${provider.trackers.map((s) => s.key).join(', ')}`,
    )
  }
  return { data_source_id: sourceId, tracker_key: trackerKey, tracker_params: {} }
}

/** Every formula signal's (id, formula), for the rename rewrite and the delete refusal. */
async function readFormulas(): Promise<{ id: string; formula: string }[]> {
  const rows = await db.selectFrom('signals').select(['id', 'formula']).where('formula', 'is not', null).orderBy('id').execute()
  return rows as { id: string; formula: string }[]
}

/**
 * Validate a proposed formula (signals/formula.ts) and derive its `depends_on`. The rules:
 *
 *   • It must parse - the error carries the character position.
 *   • A formula signal is a `manual` signal with no provider binding: its points are computed,
 *     so neither a deriver nor a sync may also own them.
 *   • Every referenced id must exist, and a formula may not read itself; cycles through other
 *     formulas are refused by the depends_on walk, since depends_on IS the formula's refs.
 *
 * Returns the trimmed formula and its refs (unique, in order of appearance), or nulls for none.
 */
function validateFormula(
  id: string,
  raw: string | null,
  effective: { source: SignalSource; data_source_id: string | null },
): { formula: string; refs: string[] } | null {
  const formula = raw?.trim() || null
  if (!formula) return null
  let refs: string[]
  try {
    refs = formulaRefs(parseFormula(formula))
  } catch (e) {
    throw new Error(`signal ${id}: ${e instanceof FormulaError ? e.message : String(e)}`)
  }
  if (effective.source === 'derived') {
    throw new Error(`signal ${id} is a derived signal - its rows are owned by deriver code, so it cannot also be a formula. Create a manual signal for the formula instead.`)
  }
  if (effective.data_source_id) {
    throw new Error(
      `signal ${id} is connected to data source ${effective.data_source_id} - a formula signal's points are computed, so unbind it (data_source_id '') in the same call or create a separate signal for the formula`,
    )
  }
  if (refs.length === 0) throw new Error(`signal ${id}: a formula must reference at least one signal`)
  if (refs.includes(id)) throw new Error(`signal ${id}: a formula cannot reference its own signal (dependency cycle)`)
  return { formula, refs }
}

/**
 * Create or update a signal definition. Partial: provided fields overwrite; the rest keep their
 * stored value (or a default on first insert - a fresh definition is a `manual` day-grain snapshot
 * on the source-less `business` channel unless told otherwise).
 */
export async function upsertSignalDefinition(input: SignalDefinitionInput): Promise<SignalDefinition> {
  if (!SIGNAL_ID.test(input.id)) {
    throw new Error(`invalid signal id "${input.id}" (lowercase; a-z 0-9 . _ @ / - ; must start alphanumeric)`)
  }
  // A row the frame cannot read (its area, or a formula's hidden input) is refused as not found
  // instead of being overwritten by an insert that collides with it.
  const stored = await readRecord<SignalDefinition>(SIGNAL_DEFINITIONS, { id: input.id })
  const prev = await readSignalDefinition(input.id)
  if (stored && !prev) throw new Error(`signal ${input.id} not found`)
  // A create under an id that exists but is hidden: the primary key would refuse it anyway, so say
  // the id is taken without saying more (and never turn the insert into an update of that row).
  if (!stored && (await asSystem('signals: id taken check', () => readRecord<SignalDefinition>(SIGNAL_DEFINITIONS, { id: input.id })))) {
    throw new Error(`signal id ${input.id} is not available`)
  }
  if (input.owner != null) await assertKnownUser(input.owner)
  const sourceId = input.data_source_id !== undefined ? input.data_source_id : (prev?.data_source_id ?? null)
  const trackerKey = input.tracker_key !== undefined ? input.tracker_key : (prev?.tracker_key ?? null)
  const inBox = Boolean(trackerKey?.trim()) && !sourceId?.trim()
  const wasInBox = prev ? isBoxTrackerSignal(prev) : false
  // A Box tracker signal is derived (the tracker owns its live points); leaving that binding
  // makes it an ordinary manual signal again unless the caller says otherwise.
  const source: SignalSource = inBox ? 'derived' : (input.source ?? (wasInBox ? 'manual' : (prev?.source ?? 'manual')))
  const binding = await normalizeBinding(input.id, source, {
    data_source_id: sourceId,
    tracker_key: trackerKey,
    tracker_params: input.tracker_params ?? (inBox && prev && prev.tracker_key === trackerKey?.trim() ? prev.tracker_params : {}),
  })
  // A formula's depends_on is DERIVED from its refs (any depends_on passed alongside is replaced);
  // clearing the formula keeps the edges as they are unless depends_on is passed too.
  const formula = validateFormula(input.id, input.formula !== undefined ? input.formula : (prev?.formula ?? null), {
    source,
    data_source_id: binding.data_source_id,
  })
  // The owning area follows the data: a Box tracker's feature, `signals` for a provider feed;
  // otherwise the caller's declaration, then the stored area unless a binding was just dropped.
  const area = inBox
    ? trackerArea(binding.tracker_key!)
    : binding.data_source_id
      ? 'signals'
      : storedArea(input.area ?? (prev && !wasInBox && !prev.data_source_id ? prev.area : 'signals'))
  // Write on the row's current area and on the one it moves to (row security refuses it too).
  if (prev) requireReachArea(prev.area, 'write')
  requireReachArea(area, 'write')
  const dependsOn = formula
    ? await normalizeDependsOn(input.id, formula.refs)
    : input.depends_on !== undefined
      ? await normalizeDependsOn(input.id, input.depends_on)
      : list(prev?.depends_on)
  const record: Record<string, unknown> = {
    id: input.id,
    label: input.label ?? prev?.label ?? input.id,
    signal_group: input.signal_group ?? prev?.signal_group ?? '',
    unit: input.unit !== undefined ? input.unit : (prev?.unit ?? null),
    channel: input.channel ?? prev?.channel ?? MANUAL_SIGNAL_CHANNEL,
    source,
    interval: input.interval ?? prev?.interval ?? 'day',
    accumulation: input.accumulation ?? prev?.accumulation ?? 'snapshot',
    direction: input.direction ?? prev?.direction ?? 'up',
    owner: input.owner !== undefined ? input.owner : (prev?.owner ?? null),
    description: input.description ?? prev?.description ?? '',
    depends_on: dependsOn,
    area,
    ...binding,
    formula: formula?.formula ?? null,
    thresholds: input.thresholds !== undefined ? normalizeThresholds(input.id, input.thresholds) : numbers(prev?.thresholds),
    sort: input.sort ?? prev?.sort ?? 0,
    ...(input.actor ? { actor: input.actor } : {}),
  }
  // An update sends only the columns it changes and the record layer merges the rest from the row
  // it locks in its own write: writing back every column of the read above would undo an edit
  // committed meanwhile (a lost update). A create is insert-only.
  const saved = norm(
    stored
      ? await upsertRecord<SignalDefinition>(SIGNAL_DEFINITIONS, changedColumns(SIGNAL_DEFINITIONS, stored, record, BINDING_GROUPS), { mustExist: true })
      : await upsertRecord<SignalDefinition>(SIGNAL_DEFINITIONS, record, { prev: null, createOnly: true }),
  )
  const trackerDerive = await import('./tracker-derive.js')
  if (inBox) {
    // A bind, a re-bind or a parameter change: compute the points now rather than at the next
    // warehouse-derive. A failing compute leaves the definition saved and says so in the log.
    const changed =
      !wasInBox ||
      prev?.tracker_key !== saved.tracker_key ||
      JSON.stringify(prev?.tracker_params ?? {}) !== JSON.stringify(saved.tracker_params) ||
      prev?.interval !== saved.interval ||
      prev?.accumulation !== saved.accumulation
    if (changed) {
      try {
        await trackerDerive.deriveTrackerSignal(saved.id)
      } catch (err) {
        console.warn(`[trackers] ${saved.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else if (wasInBox) {
    // Unbinding a Box tracker takes its computed points with it: they were never observations,
    // and left behind they would shadow every manual point entered from here on.
    await pointWrite([saved], async () => {
      await db.deleteFrom('signal_points').where('signal_id', '=', saved.id).where('source', '=', 'live').execute()
      emitAreaChange('table:signal_points', [saved.area])
    })
  }
  return saved
}

/**
 * Rename a signal definition's id, cascading to everything that names the id: other definitions'
 * `depends_on` edges, formula references, board nodes, the signal-owner override, whatever
 * registered signal hooks re-point (goals, trigger filters), and the signal's points.
 *
 * Renaming a `source: 'derived'` signal is REFUSED: its id is generated by deriver code, so the
 * next pull would re-register the old id and strand the rename. Curate the label instead.
 */
export async function renameSignalDefinition(oldId: string, newId: string, actor?: string): Promise<SignalDefinition> {
  if (actor) await assertKnownActor(actor)
  const def = await readSignalDefinition(oldId)
  if (!def) throw new Error(`signal ${oldId} not found`)
  if (newId === oldId) return def
  if (!SIGNAL_ID.test(newId)) {
    throw new Error(`invalid signal id "${newId}" (lowercase; a-z 0-9 . _ @ / - ; must start alphanumeric)`)
  }
  // A Box tracker signal is derived, but its id was chosen by a person, not generated.
  if (def.source === 'derived' && !isBoxTrackerSignal(def)) {
    throw new Error(
      `cannot rename derived signal ${oldId}: its id is generated by deriver code and the next pull would re-register the old id. Edit the label instead (curation wins over the deriver's strings).`,
    )
  }
  // A fixed core command (BOX-Review W8 finding 7): write on the area is authorized in the request
  // (again if the policy moves before admission), then one system transaction moves the id (the
  // points follow by foreign key), and every depends_on edge and formula naming it, in every area.
  // The old row is locked and rechecked (still there, still in the authorized area); a definition
  // already under the new id refuses.
  await coreCommand('signals: rename cascade', () => requireReachArea(def.area, 'write'), async () => {
    const locked = await db.selectFrom('signals').select('area').where('id', '=', oldId).forUpdate().execute()
    if (!locked.length || locked[0]!.area !== def.area) throw new Error(`signal ${oldId} not found`)
    if ((await db.selectFrom('signals').select('id').where('id', '=', newId).execute()).length) throw new Error(`cannot rename to ${newId}: a signal with that id already exists`)
    // The signal's whole history moves with it: signal_points' foreign key cascades the id.
    await db.updateTable('signals')
      .set({ id: newId, ...stamp(actor) })
      .where('id', '=', oldId)
      .execute()
    const touched = [newId]
    for (const [otherId, deps] of await readDependsEdges()) {
      if (deps.includes(oldId)) {
        await writeDependsOn(otherId, [...new Set(deps.map((d) => (d === oldId ? newId : d)))], actor)
        touched.push(otherId)
      }
    }
    // Formulas name their inputs by id: rewrite them token by token (never a string replace - `mrr`
    // must not touch `churned-mrr`). depends_on was re-pointed just above.
    for (const f of await readFormulas()) {
      if (!formulaRefsOf(f.formula).includes(oldId)) continue
      await db.updateTable('signals')
        .set({ formula: renameFormulaRef(f.formula, oldId, newId), ...stamp(actor) })
        .where('id', '=', f.id)
        .execute()
      touched.push(f.id)
    }
    emitAreaChange('table:signals', await areasOf(touched))
    emitAreaChange('table:signal_points', [def.area])
  })
  // Outside the signals data, each owner re-points in its own area (a board, a goal, a trigger
  // filter run on their own logins): these follow the committed rename and are not part of it.
  // Circuit-board placements are keyed by signal id too - a board left holding the old id would
  // silently drop the node at render (the same class of bug `signal_points` hit on 2026-08-10).
  // The board store port reaches a board recipe when the Box has one, and does nothing otherwise.
  await renameBoardRef('signal', oldId, newId, actor)
  // Everything OUTSIDE data that holds a signal id (initiative bindings, alert rules) re-points
  // itself through the hooks port; data does not know what those things are.
  for (const h of signalHooks()) await h.onRename?.(oldId, newId, actor)
  const owners = readSignalOwnersFile()
  if (oldId in owners.signals) {
    owners.signals[newId] = owners.signals[oldId]
    delete owners.signals[oldId]
    writeSignalOwnersFile(owners)
  }

  return (await readSignalDefinition(newId))!
}

export interface SignalDeleteReport {
  id: string
  /** Definitions whose `depends_on` referenced the deleted signal - the edge was pruned. */
  pruned_from: string[]
  /** Boards the signal was PLACED on - the placement was pruned. Unlike points, a
   *  placement carries no history worth resurrecting, so it goes with the definition. Empty in a
   *  Box without boards. */
  pruned_from_boards: string[]
  /** Objects outside data (goals, alert rules) still referencing the id, as `<feature>:<id>`.
   *  Left in place on purpose: a visible dead reference beats a silently narrowed object. */
  bound_initiatives: string[]
  warnings: string[]
}

/**
 * Delete a signal definition and its points (BOX-Review W8 finding 6: points never outlive their
 * signal, since a point under no signal is unreachable). Prunes the id from every other
 * definition's `depends_on`; initiative bindings are reported, not touched (a visible dead binding
 * beats a silently narrowed initiative). A formula reading the signal refuses the delete.
 *
 * A fixed core command (coreCommand): write on the signal's area is checked in the request, then
 * one system transaction locks and rechecks the row and prunes edges in every area. A refusal names only the
 * formulas the caller can read and counts the rest.
 */
export async function deleteSignalDefinition(id: string, actor?: string): Promise<SignalDeleteReport> {
  if (actor) await assertKnownActor(actor)
  const def = await readSignalDefinition(id)
  if (!def) throw new Error(`signal ${id} not found`)
  let visible = new Set<string>()
  const refuse = (readers: string[]): never => {
    const named = readers.filter((r) => visible.has(r))
    const hidden = readers.length - named.length
    const parts = [...(named.length ? [`formula signal(s) ${named.join(', ')}`] : []), ...(hidden ? [`${hidden} formula signal(s) you cannot see`] : [])]
    throw new Error(`cannot delete ${id}: ${parts.join(' and ')} read it - edit or clear those formulas first`)
  }

  const pruned: string[] = []
  const authorize = async () => {
    requireReachArea(def.area, 'write')
    visible = new Set((await readSignalDefinitions()).map((d) => d.id))
  }
  await coreCommand('signals: delete cascade', authorize, async () => {
    const locked = await db.selectFrom('signals').select('area').where('id', '=', id).forUpdate().execute()
    if (!locked.length || locked[0]!.area !== def.area) throw new Error(`signal ${id} not found`)
    const readers = (await readFormulas()).filter((f) => f.id !== id && formulaRefsOf(f.formula).includes(id)).map((f) => f.id)
    if (readers.length > 0) refuse(readers)
    for (const [otherId, deps] of await readDependsEdges()) {
      if (otherId !== id && deps.includes(id)) {
        await writeDependsOn(otherId, deps.filter((d) => d !== id), actor)
        pruned.push(otherId)
      }
    }
    // The points go with it (signal_points' foreign key cascades the delete).
    const areas = [def.area, ...(await areasOf(pruned))]
    await db.deleteFrom('signals').where('id', '=', id).execute()
    emitAreaChange('table:signals', areas)
    emitAreaChange('table:signal_points', [def.area])
  })
  const prunedBoards = await pruneBoardRef('signal', id, actor)

  const bound = (await signalReferences(id)).map((r) => `${r.kind}:${r.id}`)

  const warnings: string[] = []
  if (bound.length > 0) {
    warnings.push(`${bound.join(', ')} still reference ${id} - re-point or clear them`)
  }
  if (def.source === 'derived' && !isBoxTrackerSignal(def)) {
    warnings.push(`the deriver still writes ${id} - the next derive re-registers the definition`)
  }
  // pruned_from names only definitions the caller can read.
  return { id, pruned_from: pruned.filter((p) => visible.has(p)), pruned_from_boards: prunedBoards, bound_initiatives: bound, warnings }
}

// --- auto-registration ---------------------------------------------------------------------------

/**
 * Ensure a definition exists for every signal id in `rows`, owned by the writing feature's `area`
 * (`crm`, `support`, `data-sync`) - called by the row writers
 * (signals/write.ts) before they write. Cheap on the
 * hot path: one SELECT of existing ids; no writes at all in the common nothing-missing case. New
 * definitions are `source: 'derived'`, identity strings from the rows, day-grain snapshot, with
 * `owner` seeded ONCE from the signal-owner resolution (signals/owners.ts).
 *
 * NEVER overwrites: the insert is `ON CONFLICT DO NOTHING` at the SQL level, so a concurrent human
 * edit cannot be clobbered even if it lands between the existence check and the insert. Never
 * deletes - a definition whose signal stops arriving simply stays.
 */
export async function autoRegisterDefinitions(rows: SignalRow[], area: string): Promise<number> {
  storedArea(area)
  if (rows.length === 0) return 0
  // The first row of a signal carries the same identity strings as every other (denormalized).
  const bySignal = new Map<string, SignalRow>()
  for (const r of rows) if (!bySignal.has(r.signal_id)) bySignal.set(r.signal_id, r)

  const existing = new Set((await db.selectFrom('signals').select('id').execute()).map((r) => r.id))
  const missing = [...bySignal.values()].filter((r) => !existing.has(r.signal_id))
  if (missing.length === 0) return 0

  const owners = readSignalOwnersFile()
  await withWrite(async () => {
    for (const r of missing) {
      await db.insertInto('signals')
        .values({
          id: r.signal_id, label: r.label, signal_group: r.signal_group, unit: r.unit, channel: r.channel,
          source: 'derived', interval: 'day', accumulation: 'snapshot', direction: 'up',
          owner: resolveSignalOwner(owners, r.channel, r.signal_id), description: '', depends_on: '[]', area,
          sort: 0, created_at: now(), updated_at: now(), created_by: null, updated_by: null,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute()
    }
    emitAreaChange('table:signals', [area])
  }, { reach: 'core' })
  return missing.length
}
