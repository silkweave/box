// A list's own view state, for a DataGrid whose host does not keep the view itself.

import * as React from 'react'
import { readStored, writeStored } from '../lib/usePersistedState.ts'
import type { BoardBarValue } from '../board/BoardViewBar.tsx'
import { normalizeAll } from '../filters/match.ts'
import type { FilterSchema } from '../filters/types.ts'

/** What the browser keeps: everything but the search. */
type Kept = Pick<BoardBarValue, 'sort' | 'sortDir' | 'groupBy' | 'columns' | 'layout' | 'filters' | 'pinned'>

/** What the list offers, so a kept value it no longer offers falls back to the default. */
export interface ListViewOffer {
  sort: readonly string[]
  groupBy: readonly string[]
  columns: readonly string[]
  layouts: readonly string[]
  /** The filter fields by type: kept filters and pins on fields the list no longer offers drop. */
  filters: FilterSchema
}

/**
 * A list's view as state: `[view, patch]`, the pair `DataGrid` takes as `view` / `onViewChange`.
 * `DataGrid` calls it itself when the host passes no `view`; a host calls it only to read the view
 * outside the grid (rare: a page with presets keeps its view in the preset system instead).
 * `storageKey` keeps sort, grouping, columns, layout, filters and pinned fields in this browser;
 * search lasts while the list is mounted. A kept axis the list no longer offers falls back to `initial`, read
 * once on mount: give the grid a new React `key` when its offered axes or `storageKey` change.
 */
export function useListView(initial: BoardBarValue, offer: ListViewOffer, storageKey?: string): [BoardBarValue, (patch: Partial<BoardBarValue>) => void] {
  const [view, setView] = React.useState<BoardBarValue>(() => {
    if (!storageKey) return initial
    const kept = readStored<Partial<Kept>>(storageKey, {}, (v) => !!v && typeof v === 'object')
    return {
      ...initial,
      ...(kept.sort !== undefined && offer.sort.includes(kept.sort) ? { sort: kept.sort, sortDir: kept.sortDir } : {}),
      ...(kept.groupBy !== undefined && (kept.groupBy === 'none' || offer.groupBy.includes(kept.groupBy)) ? { groupBy: kept.groupBy } : {}),
      ...(Array.isArray(kept.columns) ? { columns: kept.columns.filter((k) => offer.columns.includes(k)) } : {}),
      ...(kept.layout !== undefined && offer.layouts.includes(kept.layout) ? { layout: kept.layout } : {}),
      ...(kept.filters && typeof kept.filters === 'object' ? { filters: normalizeAll(offer.filters, kept.filters) } : {}),
      ...(Array.isArray(kept.pinned) ? { pinned: [...new Set(kept.pinned.filter((k) => typeof k === 'string' && k in offer.filters))] } : {}),
    }
  })
  const patch = (p: Partial<BoardBarValue>): void =>
    setView((cur) => {
      const next = { ...cur, ...p }
      if (storageKey) writeStored<Kept>(storageKey, { sort: next.sort, sortDir: next.sortDir, groupBy: next.groupBy, columns: next.columns, layout: next.layout, filters: next.filters, pinned: next.pinned })
      return next
    })
  return [view, patch]
}
