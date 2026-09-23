/** Wire contract shared by the supervisor and the browser. No application registration imports. */
export const BROWSER_PROTOCOL = 1 as const
export const BROWSER_MAX_RESULT_BYTES = 6 * 1024 * 1024
export type BrowserCommand =
  | { op: 'snapshot' }
  | { op: 'inspect'; ref: string }
  | { op: 'click'; ref: string }
  | { op: 'type'; ref: string; text: string; append?: boolean }
  | { op: 'select'; ref: string; value: string }
  | { op: 'scroll'; ref?: string; x: number; y: number }
  | { op: 'navigate'; path: string }
  | { op: 'style'; ref: string; styles?: Record<string, string> }
  | { op: 'screenshot'; ref?: string }

export interface BrowserGrant {
  sessionId: string
  principalId: string
  tabId: string
  generation: string
  nonce: string
  expiresAt: number
}
export interface BrowserTab {
  id: string
  principalId: string
  display: string
  generation: string | null
  path: string
}
export interface BrowserControlState {
  tabId: string
  tabs: BrowserTab[]
  grant: BrowserGrant | null
  reason: string
  pending: string | null
  lastAction: { op: string; ok: boolean; at: number } | null
}
export type BrowserServerMessage =
  | { type: 'state'; state: BrowserControlState }
  | { type: 'command'; id: string; grant: BrowserGrant; command: BrowserCommand; deadline: number }
  | { type: 'settled'; id: string; nonce: string; generation: string; ok: boolean }
  | { type: 'error'; message: string }

export function parseBrowserCommand(value: unknown): BrowserCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a browser command object')
  const v = value as Record<string, unknown>
  const text = (key: string, max = 200): string => {
    if (typeof v[key] !== 'string' || (v[key] as string).length > max || (v[key] as string).includes('\0')) throw new Error(`Invalid ${key}`)
    return v[key] as string
  }
  const ref = (): string => { const result = text('ref'); if (!result) throw new Error('Expected an element reference'); return result }
  switch (v.op) {
    case 'snapshot': return { op: v.op }
    case 'inspect': case 'click': return { op: v.op, ref: ref() }
    case 'type':
      if (v.append !== undefined && typeof v.append !== 'boolean') throw new Error('Invalid append')
      return { op: v.op, ref: ref(), text: text('text', 10_000), append: v.append as boolean | undefined }
    case 'select': return { op: v.op, ref: ref(), value: text('value', 1000) }
    case 'scroll':
      if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 10_000 || Math.abs(v.y) > 10_000) throw new Error('Scroll distances must be finite and within 10000 pixels')
      return { op: v.op, ref: v.ref === undefined ? undefined : ref(), x: v.x, y: v.y }
    case 'navigate': return { op: v.op, path: text('path', 2000) }
    case 'style': {
      if (v.styles !== undefined && (!v.styles || typeof v.styles !== 'object' || Array.isArray(v.styles) || Object.keys(v.styles).length > 12 || Object.values(v.styles).some(x => typeof x !== 'string' || x.length > 100))) throw new Error('Invalid styles')
      return { op: v.op, ref: ref(), styles: v.styles as Record<string, string> | undefined }
    }
    case 'screenshot': return { op: v.op, ref: v.ref === undefined ? undefined : ref() }
    default: throw new Error('Unknown browser operation')
  }
}

/** Preview controls never target authentication, infrastructure or credential/settings pages. */
export function browserPreviewPath(value: unknown): string | null {
  // Control characters and whitespace must not be normalized into a different URL.
  // oxlint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null
  try {
    const url = new URL(value, 'http://box.local')
    let decoded = decodeURIComponent(url.pathname)
    if (decoded.includes('%')) decoded = decodeURIComponent(decoded)
    if (decoded.includes('\\') || decoded.startsWith('//')) return null
    const normalized = new URL(decoded, 'http://box.local')
    if (url.origin !== 'http://box.local' || normalized.origin !== 'http://box.local' || /^\/(builder(?:-[^/]+)?|api|trpc|mcp|login|auth|settings)(\/|$)/i.test(normalized.pathname)) return null
    if ([...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization|code/i.test(key))) return null
    return url.pathname + url.search + url.hash
  } catch { return null }
}
