// The vocabulary-FREE half of a module's board machinery: persistence, the repair-not-reset read,
// preset resolution, and the structural equality that tells "you are on a preset" from "you edited
// it". Three modules use it (Content, the CRM, Initiatives) and they share none of their axes - so
// what is lifted here is deliberately only the part that has no opinion about what a filter MEANS.
// What a filter IS (options, a person, a date, a number, text, a flag) is the filter kit's
// (`@silkweave/box-ui/filters`); each module declares a static `FILTER_SCHEMA` (field key -> type)
// and these helpers repair, compare and count its filters by that schema.
//
// The split, stated once so the next module does not have to rediscover it:
//
//   • HERE: how a view is stored, repaired, named, saved, selected and compared. Subtle, easy to get
//     wrong, and identical for every module - a second hand-rolled copy would drift.
//   • IN EACH MODULE's own `*View.ts`: what the columns/filters/sorts/groupings mean, what the
//     default presets are (and which filters they pin), and how rows are filtered (`matchAll` over
//     the module's schema), sorted and grouped. Forcing those into one union
//     type is how you end up with a `Filters` carrying `impact` for accounts and `channel`
//     for content.
//
// A module supplies its own `normalize` (which decides how a stored view of ITS shape is repaired),
// its own `same`, and its default presets; everything below is mechanical.
//
// TWO STORAGE TIERS, and the line between them is the load-bearing idea:
//
//   • PRESETS ARE GLOBAL - one shared list per module in tenant config, over `presets.ts`. A named
//     lens is a team artifact ("the Friday view"), so everyone sees the same names and any internal
//     user may edit any of them. There is no personal tier and no unchangeable tier: the built-ins
//     are a seed, not a floor (2026-08-12).
//   • THE LIVE VIEW stays per-browser localStorage. What you have filtered right now is a cursor, not
//     an artifact; syncing it would mean one person's filter click moving everybody else's screen.
//
// WHICH PRESET YOU ARE ON is per browser too (`basedOn` in localStorage), beside the live view it
// was applied to: the list's address stays clean (`/crm/deals`), and a reload keeps your half-edited
// session. Picking a preset is choosing a lens, not opening a page, so it adds no history entry and a
// link does not carry it.
//
// The live view is a MODULE-level store rather than per-component state, because two components read
// it at once (the sidebar's preset list and the board itself) and two `useState`s would drift apart
// the moment either one wrote.

import { useCallback, useEffect, useState } from 'react'
import type { BoardLayout, SortDir } from '@silkweave/box-ui/board'
import { countActive, normalizeAll, sameAll, type FilterSchema, type Filters } from '@silkweave/box-ui/filters'
import { readStored, writeStored } from '../lib/usePersistedState.ts'
import { isStringArray } from '../lib/guards.ts'
import {
  deletePreset,
  reorderPresets,
  savePreset,
  seedPresets,
  updatePreset,
  usePresets,
  type PresetModule,
  type PresetRecord,
  type PresetSeed,
} from './presets.ts'

/**
 * The two axes the library's board bar also reads, re-exported so a module names them once. They are
 * ITS types on purpose: a stored view and the control that edits it have to agree about what "board"
 * and "desc" are, and one vocabulary across the modules is what keeps a shared `normalize` from
 * needing a per-module table. (The CRM calls its board a "Pipeline" - that is a LABEL.) A module
 * that draws a layout of its own (a timeline) widens its `layout` to `BoardLayout | 'timeline'` and
 * offers it through its spec's `layouts`.
 */
export type { BoardLayout, SortDir }

/** The axes every module's view state carries. Each narrows them to its own enums; this is the
 *  shape the shared bar and store are allowed to assume. */
export interface BaseViewState {
  search: string
  /** A `BoardLayout`, or a value of the module's own layout (narrowed per module). */
  layout: string
  groupBy: string
  /** OPTIONAL, because a module may have no sort axis at all - Initiatives has none (2026-08-13):
   *  its rows sit in the order they were created and only its tasks are arranged by hand. A module
   *  without one hands the bar an empty `sort` list and the control never renders. */
  sort?: string
  sortDir?: SortDir
  /** Field key → typed filter value (`@silkweave/box-ui/filters`); absent or null is no filter.
   *  Narrowed per module by a type alias, checked against the module's `FilterSchema`. */
  filters: Filters
  /** The filter fields pinned to the bar as chips, in bar order (known keys only, no repeats). A
   *  preset stores them; `pinnedOf` reads them and `sameOrder` compares them. */
  pinned: string[]
  /** Optional column keys, IN RENDER ORDER, in the module's own vocabulary. */
  columns: readonly string[]
}

/** One preset as the UI sees it - the server record with its state already repaired to `S`. */
export interface Preset<S> {
  name: string
  description: string | null
  state: S
  /** Icon key (`components/board/presetIcons`), or null for the default. */
  icon: string | null
  updated_at: string
  updated_by: string | null
}

/** What a module's view hook hands its components. */
export interface ViewStore<S> {
  view: S
  setView: (next: S | ((prev: S) => S)) => void
  /** Update one field of the live view. */
  patch: <K extends keyof S>(key: K, value: S[K]) => void
  /** The team's presets for this module, in their order (empty until the first fetch lands). */
  presets: Preset<S>[]
  /**
   * The preset this browser is on, or null. It does NOT go away when you edit a filter - the picker
   * keeps showing the lens you came from and marks it changed instead, because "Custom view" threw
   * away the one fact you need to decide between saving over it and saving a new one.
   */
  selected: string | null
  /** The live state differs from what `selected` shows - or, with nothing selected, from the module
   *  default. This is what puts Save New / Save Existing / Reset on screen. */
  dirty: boolean
  select: (name: string) => void
  /** Create or overwrite a preset with what is on screen. */
  save: (name: string, icon?: string | null, description?: string | null) => Promise<void>
  /**
   * Edit one existing preset's TITLE, one-liner or icon in place; omitted fields are left alone.
   * Deliberately cannot rewrite what a preset SHOWS - that is `save`, from the bar, where you are
   * looking at exactly what you would be storing. The manage dialog used to offer it too and had to
   * ask "are you sure" precisely because from there it could be aimed at a preset you were not
   * looking through.
   */
  update: (
    name: string,
    patch: { name?: string; description?: string | null; icon?: string | null },
  ) => Promise<void>
  /** Set the team's order for this module (names in their new order). */
  reorder: (names: string[]) => Promise<void>
  /** Delete a preset - for everyone. */
  remove: (name: string) => Promise<void>
  /** Re-add any built-in the team has deleted. Never touches a preset that is still there. */
  restoreDefaults: () => Promise<void>
  /** True when at least one built-in is missing, i.e. "Restore default presets" has work to do. */
  missingDefaults: number
  /** Throw away the edits: back to what `selected` shows, or to the module default when nothing is
   *  selected. */
  reset: () => void
  /** The shared list has not arrived yet. */
  loading: boolean
  /** The signed-in principal may write this module's presets (save, manage, restore). A reader
   *  selects and resets only; before a writer seeds the module it sees the built-ins, read-only. */
  canWrite: boolean
  /** The last read or write failure, for the bar to show verbatim. */
  error: string | null
}

export interface ViewStoreSpec<S extends BaseViewState> {
  /** Module id as the server knows it - which shared list this store reads. */
  module: PresetModule
  /** localStorage prefix, e.g. `appKey('crm')` - the LIVE view hangs off it. */
  storageKey: string
  defaultView: S
  /** The module's built-in presets. A SEED: written to the team's list the first time anybody opens
   *  the module, and ordinary editable records from that moment on. */
  defaultPresets: { name: string; description: string; icon: string; state: S }[]
  /**
   * Read one stored view, REPAIRING what can be repaired and returning null only when the value is
   * not a view at all. A stored preset is the team's own work, so a release that renames a column
   * migrates it rather than silently dropping the preset.
   */
  normalize: (raw: unknown) => S | null
  /** Structural equality - compared field by field, never by JSON string (key order does not
   *  survive a normalize round trip, and a reloaded preset must not read as "Custom view"). */
  same: (a: S, b: S) => boolean
  /** The preset a browser that has never picked one starts on (the first built-in, "Pipeline"),
   *  instead of the module default with nothing selected. Skipped if the preset no longer exists. */
  initialPreset?: string
}

/**
 * Build a module's view hook: a shared live-view store plus the team's presets off the server.
 */
export function createViewStore<S extends BaseViewState>(spec: ViewStoreSpec<S>): () => ViewStore<S> {
  const liveKey = `${spec.storageKey}.view`
  const basedOnKey = `${spec.storageKey}.basedOn`
  const seed: PresetSeed[] = spec.defaultPresets.map((p) => ({
    name: p.name,
    description: p.description,
    icon: p.icon,
    state: p.state,
  }))

  // --- the live view: one module-level value, localStorage-backed, subscribed by every consumer ---
  let live: S | null = null
  const listeners = new Set<() => void>()
  const emit = (): void => listeners.forEach((l) => l())
  const readLive = (): S => (live ??= readStored(liveKey, spec.defaultView, undefined, spec.normalize))
  const writeLive = (next: S): void => {
    live = next
    writeStored(liveKey, next)
    emit()
  }

  // Which preset this edit session started from. Kept beside the view rather than inside it: it is
  // bookkeeping about where you came from, not part of what the board shows, so it must not reach
  // the module's `normalize`, its `same` (a view would stop matching itself), or the state that gets
  // written to the shared list. `undefined` = not read from storage yet, `null` = came from nowhere.
  let basedOn: string | null | undefined
  const readBasedOn = (): string | null =>
    (basedOn ??= readStored<string | null>(basedOnKey, null, (v) => v === null || typeof v === 'string'))
  const writeBasedOn = (next: string | null): void => {
    basedOn = next
    writeStored(basedOnKey, next)
    emit()
  }

  // Nothing stored for this list yet, neither a live view nor a selection (even an empty one).
  const UNSET = Symbol('unset')
  const neverUsed = (): boolean => readStored<unknown>(liveKey, UNSET) === UNSET && readStored<unknown>(basedOnKey, UNSET) === UNSET

  // --- the one-time install of this module's built-ins ---------------------------------------------
  // Fired at most once per page load per module, and a no-op on the server once the module is in
  // `seeded` - so the guard against re-adding a deleted preset lives server-side, where two tabs
  // opening the board at the same moment cannot race it.
  let seeding: Promise<void> | null = null

  let initialApplied = false

  return function useViewStore(): ViewStore<S> {
    const [local, setLocal] = useState<{ view: S; basedOn: string | null }>(() => ({
      view: readLive(),
      basedOn: readBasedOn(),
    }))
    const [writeError, setWriteError] = useState<string | null>(null)
    const { data, error: readError } = usePresets()
    const view = local.view
    useEffect(() => {
      const sync = (): void => setLocal({ view: readLive(), basedOn: readBasedOn() })
      listeners.add(sync)
      sync()
      return () => {
        listeners.delete(sync)
      }
    }, [])

    const canWrite = data?.writable.includes(spec.module) ?? false
    const seeded = data?.seeded.includes(spec.module) ?? false

    useEffect(() => {
      // Seeding is a write: a reader's seed would be refused, so a reader waits for a writer and
      // sees the built-ins locally meanwhile (below).
      if (!data || seeded || !canWrite || seeding) return
      seeding = seedPresets(spec.module, seed, 'initial').catch(() => {
        // Leave it unset so the next load retries; an unseeded module renders its (empty) list
        // rather than blocking the board.
        seeding = null
      })
    }, [data])

    // Repair each preset through THIS module's normalize; one the client cannot parse at all is
    // hidden rather than shown broken (it stays on disk, so a fix is a release away, not a re-entry).
    // A reader on a module no writer has seeded yet sees the list as the seed would leave it: what is
    // stored, then each built-in not already there by name. Nothing is written, nothing to edit.
    const stored: PresetRecord[] = data?.modules[spec.module] ?? []
    const records: PresetRecord[] =
      data && !seeded && !canWrite
        ? [
            ...stored,
            ...spec.defaultPresets
              .filter((p) => !stored.some((r) => r.name === p.name))
              .map((p) => ({ name: p.name, description: p.description ?? null, state: p.state, icon: p.icon ?? null, updated_at: '', updated_by: null })),
          ]
        : stored
    const presets: Preset<S>[] = records.flatMap((r: PresetRecord) => {
      const state = spec.normalize(r.state)
      return state
        ? [{ name: r.name, description: r.description, state, icon: r.icon, updated_at: r.updated_at, updated_by: r.updated_by }]
        : []
    })

    const setView = useCallback((next: S | ((prev: S) => S)) => {
      writeLive(typeof next === 'function' ? (next as (prev: S) => S)(readLive()) : next)
    }, [])

    // The remembered selection; `presets` decides whether that name still resolves. A preset renamed
    // or deleted elsewhere selects nothing rather than showing a title the list does not contain.
    const selectedPreset = local.basedOn ? (presets.find((v) => v.name === local.basedOn) ?? null) : null
    const selected = selectedPreset?.name ?? null
    // Nothing selected is not "nothing to save": you can arrive on a bare board, set it up, and want
    // that as a preset. So the comparison falls back to the module default, and the bar offers Save
    // New and Reset (but not Save Existing - there is nothing to overwrite).
    const dirty = !spec.same(selectedPreset ? selectedPreset.state : spec.defaultView, view)

    // A browser that has never used this list (no live view, no selection stored; not one whose
    // selection was cleared by a delete or a custom view) starts on the module's initial preset.
    // Waits until the list is authoritative: a writer's first load of an unseeded module has no
    // presets yet, and seeding brings them. A reader sees the built-ins locally (above).
    useEffect(() => {
      if (!data || initialApplied || !spec.initialPreset) return
      if (canWrite && !seeded) return
      initialApplied = true
      if (!neverUsed()) return
      const initial = presets.find((v) => v.name === spec.initialPreset)
      if (!initial) return
      writeBasedOn(initial.name)
      setView(initial.state)
    }, [data, canWrite, seeded, presets, setView])

    const patch = useCallback(
      <K extends keyof S>(key: K, value: S[K]) => setView((prev) => ({ ...prev, [key]: value })),
      [setView],
    )

    const select = useCallback(
      (name: string) => {
        const found = presets.find((v) => v.name === name)
        if (!found) return
        // Applied here rather than left to the effect so the board does not repaint twice, and so
        // re-picking the preset you are already on (after editing it) resets you onto it.
        writeBasedOn(name)
        setView(found.state)
      },
      [presets, setView],
    )

    const run = useCallback(async (op: Promise<void>): Promise<void> => {
      setWriteError(null)
      try {
        await op
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e))
      }
    }, [])

    const save = useCallback(
      async (name: string, icon?: string | null, description?: string | null): Promise<void> => {
        const trimmed = name.trim()
        if (!trimmed) return
        await run(savePreset(spec.module, trimmed, view, icon, description))
        // You are now ON that preset: a further edit offers to save back to it.
        writeBasedOn(trimmed)
      },
      [run, view],
    )

    const update = useCallback(
      async (
        name: string,
        patch: { name?: string; description?: string | null; icon?: string | null },
      ): Promise<void> => {
        const next = patch.name?.trim()
        await run(
          updatePreset(spec.module, name, { name: next, description: patch.description, icon: patch.icon }),
        )
        // A rename carries the selection with it - otherwise Save Existing would point at a name that
        // no longer exists and quietly re-create the preset under its old title.
        if (next && next !== name && readBasedOn() === name) writeBasedOn(next)
      },
      [run],
    )

    const reorder = useCallback(async (names: string[]): Promise<void> => run(reorderPresets(spec.module, names)), [run])

    const remove = useCallback(
      async (name: string): Promise<void> => {
        await run(deletePreset(spec.module, name))
        if (readBasedOn() === name) writeBasedOn(null)
      },
      [run],
    )

    const restoreDefaults = useCallback(async (): Promise<void> => run(seedPresets(spec.module, seed, 'restore')), [run])

    // "Reset" means "put back what I was looking at", which is the selected preset when there is one.
    // Only a board with nothing selected resets to the module default.
    const reset = useCallback(() => {
      if (selectedPreset) return setView(selectedPreset.state)
      writeBasedOn(null)
      setView(spec.defaultView)
    }, [selectedPreset, setView])

    const have = new Set(presets.map((p) => p.name))
    return {
      view,
      setView,
      patch,
      presets,
      selected,
      dirty,
      select,
      save,
      update,
      reorder,
      remove,
      restoreDefaults,
      missingDefaults: data ? spec.defaultPresets.filter((p) => !have.has(p.name)).length : 0,
      reset,
      loading: !data,
      canWrite,
      error: writeError ?? readError,
    }
  }
}

// --- the small repair primitives every module's `normalize` needs ---------------------------------

export { isStringArray } from '../lib/guards.ts'

/** One value from a closed vocabulary, or the fallback. The guard behind every enum-shaped field. */
export function pickEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/**
 * Rebuild a filters record from a stored one against the module's `FilterSchema`: only known keys,
 * each repaired by its type (`normalizeFilter`), and a value that no longer parses for its type (an
 * old bucket list on what is now a date) reads as no filter rather than poisoning the board. Option
 * values are NOT checked against their vocabulary - a retired value simply matches nothing, which
 * is self-healing, whereas dropping it would silently widen the user's filter.
 */
export function normalizeFilters<F extends Filters>(raw: unknown, schema: FilterSchema): F {
  return normalizeAll(schema, raw) as F
}

/** The pinned field keys of a stored view: known keys of `schema` only, de-duplicated, in order. */
export function pinnedOf(raw: unknown, schema: FilterSchema): string[] {
  return isStringArray(raw) ? [...new Set(raw.filter((k) => k in schema))] : []
}

/** Order-insensitive list equality - the right comparison for a filter axis, where the order you
 *  happened to click the chips in means nothing. */
export const sameList = (x: readonly string[], y: readonly string[]): boolean =>
  x.length === y.length && [...x].sort().join() === [...y].sort().join()

/** Order-SENSITIVE list equality - the right comparison for columns, whose order is now something a
 *  person arranges deliberately and a preset therefore has to store. */
export const sameOrder = (x: readonly string[], y: readonly string[]): boolean =>
  x.length === y.length && x.every((v, i) => v === y[i])

/** What one row ranks as on the current sort axis. `null` means "this row has no value here". */
export type SortKey = string | number | null

/**
 * Compare two rows' sort keys.
 *
 * BLANKS ALWAYS SINK, in both directions. A row with no due date is not "the earliest" when you flip
 * the arrow - it is a row with no due date, and burying it is what every one of these boards wanted
 * back when each sort baked its own direction in. Only rows that HAVE a value get reversed.
 */
export function compareKeys(a: SortKey, b: SortKey, dir: SortDir): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1
  return (a < b ? -1 : a > b ? 1 : 0) * (dir === 'desc' ? -1 : 1)
}

/** Read a stored direction, falling back to whatever the chosen sort field reads naturally. */
export const pickSortDir = (raw: unknown, fallback: SortDir): SortDir =>
  raw === 'asc' || raw === 'desc' ? raw : fallback

/** Every field of `schema` the same filter in `a` and `b`, each compared by its type (lists ignore
 *  order; an absent, null or empty value are all "no filter"). */
export function sameFilters(a: Filters, b: Filters, schema: FilterSchema): boolean {
  return sameAll(schema, a, b)
}

/** How many fields are narrowing the board right now, search included (drives the funnel's count). */
export function activeFilterCountOf(filters: Filters, search: string, schema: FilterSchema): number {
  return countActive(schema, filters) + (search.trim() ? 1 : 0)
}
