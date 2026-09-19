// "Where have I been" for a board's sidebar - the ids you opened, newest first.
//
// Both the CRM and Initiatives sidebars used to list EVERY row of the board they sit beside, which
// is a second copy of the board: by the time it scrolls it is slower than the board's own search,
// and it pushes everything else in the nav below the fold. They list the last few you actually
// opened instead.
//
// Per-browser `localStorage`, and deliberately NOT shared the way presets are: a lens is a team
// artifact, where you have been is not - syncing it would put one person's afternoon in everyone
// else's sidebar.

import { useEffect } from 'react'
import { usePersistedState } from './usePersistedState.ts'
import { isStringArray } from './guards.ts'

/** How many ids are KEPT - more than any sidebar shows, so that an entry which is deleted, filtered
 *  out or hidden shortens the visible list by one instead of leaving a permanent gap at the bottom. */
const KEPT = 30

/**
 * Track visit history for one board. Pass the currently-open id (or undefined on the board itself);
 * the stamp happens on the id CHANGING, so re-rendering something you are already looking at cannot
 * churn the list.
 *
 * Returns the ids newest-first. Resolving them to rows - and dropping the ones that no longer exist
 * - is the caller's job: this history is a hint, never a claim that the row is still there.
 */
export function useRecentIds(storageKey: string, openId: string | undefined): string[] {
  const [recent, setRecent] = usePersistedState<string[]>(storageKey, [], isStringArray)
  useEffect(() => {
    if (!openId) return
    setRecent((prev) => (prev[0] === openId ? prev : [openId, ...prev.filter((x) => x !== openId)].slice(0, KEPT)))
  }, [openId, setRecent])
  return recent
}
