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
