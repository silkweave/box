/** How long a tab may stay hidden before its live connections are released. Short tab switches
 * keep their streams; a tab left in the background stops holding server subscriptions. */
export const HIDDEN_GRACE_MS = 30_000

/** The page signals a live connection follows: navigation events on `page`, visibility on `view`. */
export interface PageSignals {
  page: EventTarget
  view: EventTarget & { readonly hidden: boolean }
  graceMs?: number
}

/** Run a live connection only while the page is active.
 * Navigation (`pagehide`, including back/forward caching, where React effect cleanup does not run)
 * releases it at once. A tab hidden for `graceMs` releases it too, so the server keeps no
 * subscriptions for tabs nobody is looking at. Showing the page again reconnects, and each feed
 * resyncs using its existing cursor/hello logic. */
export function whilePageActive(
  start: () => () => void,
  signals: PageSignals = { page: window, view: document },
): () => void {
  const { page, view, graceMs = HIDDEN_GRACE_MS } = signals
  let stop: (() => void) | undefined
  let grace: ReturnType<typeof setTimeout> | undefined
  const cancelGrace = () => {
    if (grace !== undefined) clearTimeout(grace)
    grace = undefined
  }
  const suspend = () => {
    cancelGrace()
    const cleanup = stop
    stop = undefined
    cleanup?.()
  }
  const suspendLater = () => {
    if (stop && grace === undefined) grace = setTimeout(suspend, graceMs)
  }
  const resume = () => {
    cancelGrace()
    stop ??= start()
  }
  const onVisibility = () => { if (view.hidden) suspendLater(); else resume() }
  const onShow = () => { if (view.hidden) return; resume() }
  page.addEventListener('pagehide', suspend)
  page.addEventListener('pageshow', onShow)
  view.addEventListener('visibilitychange', onVisibility)
  // Start even when opened in the background, so data loaded now is followed; the grace applies.
  resume()
  if (view.hidden) suspendLater()
  return () => {
    page.removeEventListener('pagehide', suspend)
    page.removeEventListener('pageshow', onShow)
    view.removeEventListener('visibilitychange', onVisibility)
    suspend()
  }
}
