// Read/write the signal registry (`signals`) - the durable identity + curation layer over the
// signal's history in `signal_points` (see signals/types.ts for the model). Row↔domain plumbing
// comes from the record layer (warehouse/model.ts) driven by the SIGNAL_DEFINITIONS spec; this
// module keeps only the domain semantics: create-defaults, depends_on hygiene (mirrors
// planning/state.ts normalizeBlockedBy), the rename/delete cascades, and auto-registration.
//
// Auto-registration is the reconciliation strategy for the derived world: the derived signal set
// is dynamic (account-scoped github@<id> channels, npm top-N rotation, content.published.<channel>),
// so a one-shot seed would rot. Instead every signal-row writer calls autoRegisterDefinitions()
// after persisting - it inserts a definition for any signal id that lacks one and NEVER overwrites
// an existing row (human curation always wins over the deriver's denormalized strings), and it
// never deletes (a definition whose signal disappears stays - curation is durable; cleanup is a
// human decision via signal-delete).

import { emitChange } from '../changes.js'
import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'
import type { SignalRow } from './write.js'
import { deleteRecord, readRecord, readRecords, upsertRecord } from '../warehouse/model.js'
import { SIGNAL_DEFINITIONS } from './models.js'
import { findProvider, findMeasure } from './sources/registry.js'
import { readDataSource } from './sources/state.js'
import { assertKnownActor, assertKnownUser } from '../users/state.js'
import { readSignalOwnersFile, resolveSignalOwner, writeSignalOwnersFile } from './owners.js'
import { pruneBoardRef, renameBoardRef } from './boards.js'
import { signalHooks } from './hooks.js'
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
const norm = (d: SignalDefinition): SignalDefinition => ({ ...d, depends_on: list(d.depends_on), formula: d.formula ?? null, thresholds: numbers(d.thresholds) })

/** Thresholds as stored: finite, ascending, unique. Anything else is refused, not dropped. */
function normalizeThresholds(id: string, raw: unknown[]): number[] {
  const bad = raw.filter((x) => typeof x !== 'number' || !Number.isFinite(x))
  if (bad.length > 0) throw new Error(`signal ${id}: thresholds must be finite numbers`)
  return [...new Set(raw as number[])].sort((a, b) => a - b)
}

/** Every signal definition, sorted by `sort` then id. */
export async function readSignalDefinitions(): Promise<SignalDefinition[]> {
  return (await readRecords<SignalDefinition>(SIGNAL_DEFINITIONS, { orderBy: 'sort, id' })).map(norm)
}

/** One definition, or null. */
export async function readSignalDefinition(id: string): Promise<SignalDefinition | null> {
  const d = await readRecord<SignalDefinition>(SIGNAL_DEFINITIONS, { id })
  return d ? norm(d) : null
}

// --- the dependency graph ------------------------------------------------------------------------

/** Every definition's `depends_on` edge list, as stored. */
async function readDependsEdges(): Promise<Map<string, string[]>> {
  await ensureSchema()
  const rows = await withRead<{ id: string; depends_on: string | null }>(
    `SELECT id, CAST(depends_on AS VARCHAR) AS depends_on FROM signals`,
  )
  return new Map(
    rows.map((r) => {
      try {
        const parsed: unknown = r.depends_on ? JSON.parse(r.depends_on) : []
        return [r.id, Array.isArray(parsed) ? (parsed as string[]) : []]
      } catch {
        return [r.id, []]
      }
    }),
  )
}

/** Persist one row's edge list (used by the rename/delete fixups, which bypass the upsert path). */
async function writeDependsOn(id: string, deps: string[], actor?: string): Promise<void> {
  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE signals SET depends_on = ?::JSON, updated_at = now(),
              updated_by = COALESCE(?, updated_by) WHERE id = ?`,
      [JSON.stringify(deps), actor ?? null, id],
    )
  })
}

/**
 * Clean a proposed `depends_on` list: trimmed, de-duplicated, self-reference dropped, every target
 * must exist, and the graph must stay acyclic - the same discipline as `initiatives.blocked_by`
 * (planning/state.ts normalizeBlockedBy). "MRR drives churn drives MRR" is never a true causal
 * claim, it is a data-entry mistake, and the circuit-board walk (phase B3) will follow these edges.
 */
async function normalizeDependsOn(id: string, raw: string[]): Promise<string[]> {
  const deps = [...new Set(raw.map((s) => s.trim()).filter(Boolean))].filter((d) => d !== id)
  if (deps.length === 0) return deps
  const edges = await readDependsEdges()
  const unknown = deps.filter((d) => !edges.has(d))
  if (unknown.length > 0) throw new Error(`signal ${id}: depends_on references unknown signal(s) ${unknown.join(', ')}`)

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

/**
 * Validate a proposed provider binding, the `depends_on` discipline applied to Track C's two new
 * columns. The rules, and why each one exists:
 *
 *   • BOTH OR NEITHER - a `data_source_id` with no `measure_key` (or the reverse) is a half-bound
 *     signal: the sync would find a subscriber it cannot resolve to a feed.
 *   • Unknown source id, and unknown measure key, are refused with the valid list - the same
 *     fail-with-the-reason posture as an unknown `depends_on` id.
 *   • A `source: 'derived'` signal may never carry a binding: a deriver already owns its rows, and
 *     two live writers on one signal is the exact collision this track had to design around.
 *
 * Two signals binding the same (source, measure) is deliberately ALLOWED - points are keyed per
 * signal id, so there is no integrity harm, and the one legitimate use (a renamed successor
 * coexisting during a transition) should not be blocked.
 */
async function normalizeBinding(
  id: string,
  effectiveSource: SignalSource,
  next: { data_source_id: string | null; measure_key: string | null },
): Promise<{ data_source_id: string | null; measure_key: string | null }> {
  const sourceId = next.data_source_id?.trim() || null
  const measureKey = next.measure_key?.trim() || null
  if (!sourceId && !measureKey) return { data_source_id: null, measure_key: null }
  if (!sourceId || !measureKey) {
    throw new Error(
      `signal ${id}: data_source_id and measure_key are both-or-neither - a half-bound signal has a subscriber the sync cannot resolve`,
    )
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
  if (!findMeasure(provider, measureKey)) {
    throw new Error(
      `signal ${id}: provider ${provider.id} offers no measure "${measureKey}" - valid: ${provider.measures.map((s) => s.key).join(', ')}`,
    )
  }
  return { data_source_id: sourceId, measure_key: measureKey }
}

/** Every formula signal's (id, formula), for the rename rewrite and the delete refusal. */
async function readFormulas(): Promise<{ id: string; formula: string }[]> {
  await ensureSchema()
  return withRead<{ id: string; formula: string }>(`SELECT id, formula FROM signals WHERE formula IS NOT NULL ORDER BY id`)
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
  const prev = await readSignalDefinition(input.id)
  if (input.owner != null) await assertKnownUser(input.owner)
  const source = input.source ?? prev?.source ?? 'manual'
  const binding = await normalizeBinding(input.id, source, {
    data_source_id: input.data_source_id !== undefined ? input.data_source_id : (prev?.data_source_id ?? null),
    measure_key: input.measure_key !== undefined ? input.measure_key : (prev?.measure_key ?? null),
  })
  // A formula's depends_on is DERIVED from its refs (any depends_on passed alongside is replaced);
  // clearing the formula keeps the edges as they are unless depends_on is passed too.
  const formula = validateFormula(input.id, input.formula !== undefined ? input.formula : (prev?.formula ?? null), {
    source,
    data_source_id: binding.data_source_id,
  })
  const dependsOn = formula
    ? await normalizeDependsOn(input.id, formula.refs)
    : input.depends_on !== undefined
      ? await normalizeDependsOn(input.id, input.depends_on)
      : list(prev?.depends_on)
  return norm(
    await upsertRecord<SignalDefinition>(
      SIGNAL_DEFINITIONS,
      {
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
        ...binding,
        formula: formula?.formula ?? null,
        thresholds: input.thresholds !== undefined ? normalizeThresholds(input.id, input.thresholds) : numbers(prev?.thresholds),
        sort: input.sort ?? prev?.sort ?? 0,
        ...(input.actor ? { actor: input.actor } : {}),
      },
      { prev },
    ),
  )
}

/**
 * Rename a signal definition's id, cascading to everything that names the id - the same discipline
 * as renameInitiative: other definitions' `depends_on` edges, formula references, board nodes, the
 * signal-owner override, whatever registered signal hooks re-point (goals, trigger filters), and
 * the signal's points.
 *
 * Renaming a `source: 'derived'` signal is REFUSED: its id is generated by deriver code, so the
 * next pull would re-register the old id and strand the rename. Curate the label instead.
 */
export async function renameSignalDefinition(oldId: string, newId: string, actor?: string): Promise<SignalDefinition> {
  await ensureSchema()
  if (actor) await assertKnownActor(actor)
  const def = await readSignalDefinition(oldId)
  if (!def) throw new Error(`signal ${oldId} not found`)
  if (newId === oldId) return def
  if (!SIGNAL_ID.test(newId)) {
    throw new Error(`invalid signal id "${newId}" (lowercase; a-z 0-9 . _ @ / - ; must start alphanumeric)`)
  }
  if (def.source === 'derived') {
    throw new Error(
      `cannot rename derived signal ${oldId}: its id is generated by deriver code and the next pull would re-register the old id. Edit the label instead (curation wins over the deriver's strings).`,
    )
  }
  if (await readSignalDefinition(newId)) throw new Error(`cannot rename to ${newId}: a signal with that id already exists`)
  // Rows already under the new id would collide with the moved rows on the PK.
  const clash = await withRead<{ n: number }>(`SELECT count(*) AS n FROM signal_points WHERE signal_id = ?`, [newId])
  if (Number(clash[0]?.n ?? 0) > 0) {
    throw new Error(`cannot rename to ${newId}: point rows already exist under that id`)
  }

  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE signals SET id = ?, updated_at = now(), updated_by = COALESCE(?, updated_by) WHERE id = ?`,
      [newId, actor ?? null, oldId],
    )
    // The signal's whole history moves with it, in the same transaction as the id change.
    await conn.run(`UPDATE signal_points SET signal_id = ? WHERE signal_id = ?`, [newId, oldId])
  })

  for (const [otherId, deps] of await readDependsEdges()) {
    if (deps.includes(oldId)) {
      await writeDependsOn(otherId, [...new Set(deps.map((d) => (d === oldId ? newId : d)))], actor)
    }
  }
  // Formulas name their inputs by id: rewrite them token by token (never a string replace - `mrr`
  // must not touch `churned-mrr`). depends_on was re-pointed just above.
  for (const f of await readFormulas()) {
    if (!formulaRefsOf(f.formula).includes(oldId)) continue
    const next = renameFormulaRef(f.formula, oldId, newId)
    await withWrite(async (conn) => {
      await conn.run(
        `UPDATE signals SET formula = ?, updated_at = now(), updated_by = COALESCE(?, updated_by) WHERE id = ?`,
        [next, actor ?? null, f.id],
      )
    })
  }
  // Circuit-board placements are keyed by signal id too - a board left holding the old id would
  // silently drop the node at render (the same class of bug `signal_points` hit on 2026-08-10).
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

  emitChange('table:signals')
  emitChange('table:signals')
  emitChange('table:signal_points')
  return (await readSignalDefinition(newId))!
}

export interface SignalDeleteReport {
  id: string
  /** Definitions whose `depends_on` referenced the deleted signal - the edge was pruned. */
  pruned_from: string[]
  /** Circuit boards the signal was PLACED on - the placement was pruned. Unlike points, a
   *  placement carries no history worth resurrecting, so it goes with the definition. */
  pruned_from_boards: string[]
  /** Objects outside data (goals, alert rules) still referencing the id, as `<feature>:<id>`.
   *  Left in place on purpose: a visible dead reference beats a silently narrowed object. */
  bound_initiatives: string[]
  warnings: string[]
}

/**
 * Delete a signal definition. Prunes the id from every other definition's `depends_on`; initiative
 * bindings are reported, not touched (a visible dead binding beats a silently narrowed initiative).
 * Points are NEVER deleted here: for a derived signal the deriver owns them (and the next
 * derive would re-register the definition while the signal lives - deletion is for retired
 * signal); for a manual one, removing curation should not destroy observations.
 */
export async function deleteSignalDefinition(id: string, actor?: string): Promise<SignalDeleteReport> {
  await ensureSchema()
  if (actor) await assertKnownActor(actor)
  const def = await readSignalDefinition(id)
  if (!def) throw new Error(`signal ${id} not found`)
  // A formula reading this signal would silently go blank - refuse, naming the formulas.
  const readers = (await readFormulas()).filter((f) => f.id !== id && formulaRefsOf(f.formula).includes(id)).map((f) => f.id)
  if (readers.length > 0) {
    throw new Error(`cannot delete ${id}: formula signal(s) ${readers.join(', ')} read it - edit or clear those formulas first`)
  }

  const pruned: string[] = []
  for (const [otherId, deps] of await readDependsEdges()) {
    if (otherId !== id && deps.includes(id)) {
      await writeDependsOn(otherId, deps.filter((d) => d !== id), actor)
      pruned.push(otherId)
    }
  }
  const prunedBoards = await pruneBoardRef('signal', id, actor)
  await deleteRecord(SIGNAL_DEFINITIONS, { id })

  const bound: string[] = []
  for (const h of signalHooks()) bound.push(...(await h.references?.(id) ?? []))

  const warnings: string[] = []
  if (bound.length > 0) {
    warnings.push(`${bound.join(', ')} still reference ${id} - re-point or clear them`)
  }
  const pts = await withRead<{ n: number }>(`SELECT count(*) AS n FROM signal_points WHERE signal_id = ?`, [id])
  const np = Number(pts[0]?.n ?? 0)
  if (np > 0) {
    warnings.push(
      def.source === 'derived'
        ? `${np} point row(s) remain and the deriver still writes this signal - the next derive re-registers the definition`
        : `${np} point row(s) under ${id} were left in place - they are invisible without a definition; re-creating ${id} resurfaces them`,
    )
  }
  return { id, pruned_from: pruned, pruned_from_boards: prunedBoards, bound_initiatives: bound, warnings }
}

// --- auto-registration ---------------------------------------------------------------------------

/**
 * Ensure a definition exists for every signal id in `rows` - called by the row writers
 * (signals/write.ts) before they write. Cheap on the
 * hot path: one SELECT of existing ids; no writes at all in the common nothing-missing case. New
 * definitions are `source: 'derived'`, identity strings from the rows, day-grain snapshot, with
 * `owner` seeded ONCE from the signal-owner resolution (signals/owners.ts).
 *
 * NEVER overwrites: the insert is `ON CONFLICT DO NOTHING` at the SQL level, so a concurrent human
 * edit cannot be clobbered even if it lands between the existence check and the insert. Never
 * deletes - a definition whose signal stops arriving simply stays.
 */
export async function autoRegisterDefinitions(rows: SignalRow[]): Promise<number> {
  if (rows.length === 0) return 0
  // The first row of a signal carries the same identity strings as every other (denormalized).
  const bySignal = new Map<string, SignalRow>()
  for (const r of rows) if (!bySignal.has(r.signal_id)) bySignal.set(r.signal_id, r)

  await ensureSchema()
  const existing = new Set((await withRead<{ id: string }>(`SELECT id FROM signals`)).map((r) => r.id))
  const missing = [...bySignal.values()].filter((r) => !existing.has(r.signal_id))
  if (missing.length === 0) return 0

  const owners = readSignalOwnersFile()
  await withWrite(async (conn) => {
    for (const r of missing) {
      await conn.run(
        `INSERT INTO signals
           (id, label, signal_group, unit, channel, source, interval, accumulation, direction,
            owner, description, depends_on, sort, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'derived', 'day', 'snapshot', 'up', ?, '', '[]'::JSON, 0, now(), now(), NULL, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [r.signal_id, r.label, r.signal_group, r.unit, r.channel, resolveSignalOwner(owners, r.channel, r.signal_id)],
      )
    }
  })
  emitChange('table:signals')
  return missing.length
}
