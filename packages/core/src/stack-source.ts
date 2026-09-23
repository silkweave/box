// Where a Box's Stack lives, resolved from `stack.source` in box.json (or its box.local.json
// override). Pure: no filesystem or network access, so `box stack where`, `box stack fetch` and any
// agent tooling agree on what a source string means. The accepted forms and the one deliberate
// ambiguity (a bare `owner/repo` is always GitHub, never a relative directory) are defined by
// `stackSourceKind` in box-json.ts, which the config parser also uses to refuse a malformed value.

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { stackSourceKind } from './box-json.js'

/** A Stack readable in place, or a remote the CLI clones into the Box's `.stack/` cache. */
export type StackLocation =
  | { kind: 'path'; path: string }
  | { kind: 'git'; url: string }

/** The gitignored cache directory, relative to the Box root, that holds a cloned git Stack. */
export const STACK_CACHE_DIR = '.stack'

/**
 * Resolve `source` against the Box root. Paths become absolute (`~` and `~/...` expand to the home
 * directory, everything else resolves against `boxRoot`); GitHub shorthand becomes
 * `https://github.com/<owner>/<repo>.git`; other git URLs pass through unchanged.
 */
export function resolveStackSource(source: string, boxRoot: string): StackLocation {
  const value = source.trim()
  const kind = stackSourceKind(value)
  if (kind === 'path') {
    if (value === '~') return { kind: 'path', path: homedir() }
    if (value.startsWith('~/')) return { kind: 'path', path: join(homedir(), value.slice(2)) }
    return { kind: 'path', path: resolve(boxRoot, value) }
  }
  if (kind === 'git') return { kind: 'git', url: value }
  if (kind === 'github') return { kind: 'git', url: `https://github.com/${value.replace(/\.git$/, '')}.git` }
  throw new Error(`stack.source ${JSON.stringify(source)} is not GitHub owner/repo, a git URL or a path`)
}
