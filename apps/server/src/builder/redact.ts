/**
 * Secret removal for files that leave the Box (the Builder session export). Two layers:
 *
 * - Known values: every credential-like string this Box holds (box.local.json, profile MCP token
 *   files) is replaced wherever it appears. Box access tokens carry no prefix, so a pattern cannot
 *   find them; their stored values can.
 * - Patterns: provider keys, bearer headers, JWTs, sign-in links, private keys, `token=...` style
 *   assignments and URL credentials, for secrets the Box never stored (a token an agent printed).
 *
 * Object keys that name a secret (`token`, `password`, `authorization`, ...) lose their value
 * whatever it looks like. This is best effort: the export is shown before download and its README
 * asks the sender to look it over.
 */
export const REDACTED = '[redacted]'

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|authorization|cookie|credential|session[-_]?key|client[-_]?secret)/i

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${REDACTED}`],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bbl[12]\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(box_session)=[^\s;"']+/g, `$1=${REDACTED}`],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${REDACTED}@`],
  // `TOKEN=abc`, `"apiKey": "abc"`, `password: abc`: keep the name, drop the value.
  [/\b([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*["']?)(?!\[redacted\]|<[a-z]+>)([^\s"',;&]{8,})/gi, `$1$2${REDACTED}`],
]

export interface Redactor {
  text: (value: string) => string
  /** Deep copy with secret-named keys emptied and every string run through `text`. */
  value: <T>(value: T) => T
}

/**
 * Collects credential-like strings from a parsed config: values under a secret-named key, and long
 * token-shaped strings anywhere (letters and digits, no spaces, separators or paths). Names such as
 * a profile id stay readable.
 */
export function secretValues(config: unknown): string[] {
  const found = new Set<string>()
  const tokenShaped = (value: string): boolean => value.length >= 20 && /^[A-Za-z0-9_\-+/=.]+$/.test(value) && /[0-9]/.test(value) && /[A-Za-z]/.test(value) && !value.startsWith('/')
  const visit = (node: unknown, secret: boolean): void => {
    if (typeof node === 'string') {
      if (node.length >= 8 && (secret ? !/^https?:\/\/[^@\s]*$/.test(node) && !node.startsWith('/') : tokenShaped(node))) found.add(node)
      return
    }
    if (Array.isArray(node)) { node.forEach(item => visit(item, secret)); return }
    if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) visit(value, secret || SECRET_KEY.test(key))
  }
  visit(config, false)
  return [...found]
}

/** Values of `NAME=value` lines (profile MCP token files). */
export function envFileValues(text: string): string[] {
  return text.split('\n').flatMap(line => {
    const match = /^[A-Za-z_][A-Za-z_0-9]*=(.*)$/.exec(line.trim())
    const value = match?.[1]?.replace(/^["']|["']$/g, '')
    return value && value.length >= 8 ? [value] : []
  })
}

export function createRedactor(known: Iterable<string> = []): Redactor {
  // Longest first, so a secret that contains another is removed whole.
  const values = [...new Set(known)].filter(value => value.length >= 8).sort((a, b) => b.length - a.length)
  const text = (input: string): string => {
    let out = input
    for (const secret of values) if (out.includes(secret)) out = out.split(secret).join(REDACTED)
    for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
    return out
  }
  const value = <T>(input: T): T => {
    const walk = (node: unknown, key?: string): unknown => {
      if (key !== undefined && SECRET_KEY.test(key) && node !== null && node !== undefined && typeof node !== 'boolean' && typeof node !== 'number') return REDACTED
      if (typeof node === 'string') return text(node)
      if (Array.isArray(node)) return node.map(item => walk(item))
      if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]))
      return node
    }
    return walk(input) as T
  }
  return { text, value }
}

/** The shape of a config without its values: each leaf becomes its type, so keys are visible. */
export function keysOnly(config: unknown): unknown {
  if (Array.isArray(config)) return config.map(keysOnly)
  if (config && typeof config === 'object') return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, keysOnly(v)]))
  return config === null ? 'null' : `<${typeof config}>`
}
