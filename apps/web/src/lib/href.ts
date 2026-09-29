import { useRouter, type NavigateOptions } from '@tanstack/react-router'

/**
 * Builds the URL for a route, for shell controls that navigate through a callback. The shell draws
 * them as `<a href>` (see `NavAnchor` in the UI library) so Cmd/Ctrl/Shift/middle click open the
 * route in a new tab or window; a plain click still runs the callback and routes client-side.
 * Takes the same options as `navigate`, so a caller writes the destination once in each form.
 */
export function useHref(): (options: NavigateOptions) => string {
  const router = useRouter()
  return (options) => router.buildLocation(options as never).publicHref
}

/**
 * `{ href, onClick }` for a route: spread into a crumb or crumb-menu item so it renders as a real
 * link and navigates client-side on a plain click.
 */
export function useRouteLink(): (options: NavigateOptions) => { href: string; onClick: () => void } {
  const router = useRouter()
  return (options) => ({
    href: router.buildLocation(options as never).publicHref,
    onClick: () => void router.navigate(options as never),
  })
}
