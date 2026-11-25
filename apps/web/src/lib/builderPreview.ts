/** This marks the live app embedded by the separate Builder shell, not a security boundary. */
export const isBuilderPreview = (): boolean => typeof window !== 'undefined' && window.parent !== window && window.name === 'box-builder-preview'

export function safePreviewPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  try {
    const path = new URL(value, 'http://box.local')
    if (path.origin !== 'http://box.local' || /^\/(builder(?:-assets|-agent)?|api|trpc|mcp)(\/|$)/.test(path.pathname)) return '/'
    return path.pathname + path.search + path.hash
  } catch { return '/' }
}

/**
 * Where the Builder Preview frame is when it is not showing the Box app: a page outside it such as
 * `/artifacts/<slug>/` (`path` set), or a page the shell cannot read, like a browser error page
 * (`path` null). Null while the frame shows the app, which marks itself with `<meta name="box-app">`.
 */
export function previewOutsideApp(frame: HTMLIFrameElement | null): { path: string | null } | null {
  if (!frame) return null
  let doc: Document | null = null
  try { doc = frame.contentDocument } catch { doc = null }
  if (doc?.querySelector('meta[name="box-app"]')) return null
  let path: string | null = null
  try {
    const here = frame.contentWindow?.location
    if (here?.href === 'about:blank') return null
    if (here && here.origin === location.origin) path = here.pathname + here.search + here.hash
  } catch { path = null }
  return { path }
}

/**
 * Where `reset` and **Back to** go: the last app route, or Home when the frame is at that route and
 * the page there is not usable (it failed to load or never became a controllable app page).
 */
export function previewResetTarget(current: { path: string | null; usable: boolean }, lastAppRoute: string): string {
  return !current.usable && current.path === lastAppRoute ? '/' : lastAppRoute
}

/**
 * A path the agent may open in the Preview: the broker's rules (no infrastructure, sign-in,
 * settings or secret-bearing queries) and the shell's own `safePreviewPath` must agree. Artifact
 * pages (`/artifacts/<slug>/`) are allowed. Null when the path is refused.
 */
export function previewNavigationPath(value: unknown, brokerPath: (value: unknown) => string | null): string | null {
  const allowed = brokerPath(value)
  return allowed && safePreviewPath(allowed) === allowed ? allowed : null
}

/** What the shell can read of its Preview frame, without help from the page inside it. */
export function readPreviewFrame(frame: HTMLIFrameElement | null): { page: 'app' | 'outside' | 'error' | 'loading'; path: string | null; title: string | null } {
  if (!frame) return { page: 'loading', path: null, title: null }
  let here: Location | undefined
  let path: string | null = null
  try {
    here = frame.contentWindow?.location
    if (!here || here.href === 'about:blank') return { page: 'loading', path: null, title: null }
    if (here.origin !== location.origin) return { page: 'error', path: null, title: null }
    path = here.pathname + here.search + here.hash
  } catch { return { page: 'error', path: null, title: null } }
  let doc: Document | null = null
  try { doc = frame.contentDocument } catch { doc = null }
  if (!doc) return { page: 'error', path, title: null }
  return { page: doc.querySelector('meta[name="box-app"]') ? 'app' : 'outside', path, title: doc.title || null }
}
