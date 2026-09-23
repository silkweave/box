/** Release live connections before document navigation, including back/forward caching.
 * React effect cleanup does not run when the browser preserves the document in history.
 * A restored page reconnects so each feed can resync using its existing cursor/hello logic. */
export function whilePageActive(start: () => () => void, page: EventTarget = window): () => void {
  let stop: (() => void) | undefined
  const resume = () => { stop ??= start() }
  const suspend = () => {
    const cleanup = stop
    stop = undefined
    cleanup?.()
  }
  page.addEventListener('pagehide', suspend)
  page.addEventListener('pageshow', resume)
  resume()
  return () => {
    page.removeEventListener('pagehide', suspend)
    page.removeEventListener('pageshow', resume)
    suspend()
  }
}
