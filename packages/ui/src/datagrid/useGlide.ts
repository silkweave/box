import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

const MOVE = { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' } as const
const ENTER = { duration: 180, easing: 'ease-out' } as const

/**
 * Rows that change place glide there instead of jumping, and rows that appear fade in: FLIP on the
 * rows' layout offsets (`[data-row]` under `list`), measured after every render.
 *
 * Only renders announced with the returned `glideNext` move (a fold, an unfold, a drag step, a
 * drop). Everything else (a sort, a filter, new data) redraws at once, and nothing moves for a user
 * who prefers reduced motion. A glide interrupted by the next one starts from where the row is on
 * screen, not from where its layout was, so quick drag steps stay smooth.
 */
export function useGlide(list: RefObject<HTMLElement | null>): () => void {
  const tops = useRef(new Map<string, number>())
  const next = useRef(false)
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const animate = next.current && !matchMedia('(prefers-reduced-motion: reduce)').matches
    next.current = false
    const was = tops.current
    const now = new Map<string, number>()
    for (const row of el.querySelectorAll<HTMLElement>('[data-row]')) {
      const id = row.dataset.row ?? ''
      const top = row.offsetTop
      now.set(id, top)
      if (!animate || was.size === 0) continue
      const from = was.get(id)
      if (from === undefined) {
        row.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], ENTER)
      } else {
        // A glide still running offsets the row from its old layout; start from that visual spot.
        const running = row.getAnimations()
        const offset = running.length > 0 ? new DOMMatrixReadOnly(getComputedStyle(row).transform).m42 : 0
        const shift = from + offset - top
        if (shift === 0) continue
        for (const a of running) a.cancel()
        row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], MOVE)
      }
    }
    tops.current = now
  })
  return useCallback(() => {
    next.current = true
  }, [])
}
