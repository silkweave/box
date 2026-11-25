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
