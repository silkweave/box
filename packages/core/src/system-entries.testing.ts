// The review gate for system work's entry points (PERMISSIONS 11.5), shared by core's own test
// and by each feature's `system-entries.test.ts`. Every `asSystem`, `coreCommand` and `coreRead`
// call under the scanned directories must be in the reviewed list given here, with a literal
// reason. A new, renamed or removed entry point fails until the list changes in the same commit.
// Core lists its own, the server's and the scripts' entries; a feature lists the entries under its
// own `features/<id>/` tree, so the list travels with the code it reviews.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The workspace root (the Stack, or a Box). */
export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'generated') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(path))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.') && !entry.name.includes('testing')) out.push(path)
  }
  return out
}

/** Every call in the scanned directories (relative to the workspace root): its reason, or the call site when the first argument is not a literal. */
export function scanSystemEntries(scanned: readonly string[]): { entries: Record<string, string[]>; unnamed: string[] } {
  const entries: Record<string, string[]> = {}
  const unnamed: string[] = []
  for (const root of scanned) {
    let files: string[]
    try { files = sources(join(WORKSPACE_ROOT, root)) } catch { continue }
    for (const file of files) {
      const rel = relative(WORKSPACE_ROOT, file)
      // Strip comments so prose mentioning asSystem(reason, fn) does not count as a call.
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      for (const m of text.matchAll(/\b(?:asSystem|coreCommand|coreRead)\(\s*/g)) {
        const rest = text.slice(m.index! + m[0].length)
        const lit = /^(['"`])((?:(?!\1)[^\\]|\\.)*)\1/.exec(rest)
        if (rel === 'packages/core/src/request-context.ts' || rel === 'packages/core/src/warehouse/core-command.ts') continue
        if (!lit) {
          unnamed.push(`${rel}: ${rest.slice(0, 40).replace(/\s+/g, ' ')}`)
          continue
        }
        ;(entries[rel] ??= []).push(lit[2]!.replace(/\$\{[^}]*\}/g, '*'))
      }
    }
  }
  for (const list of Object.values(entries)) list.sort()
  return { entries, unnamed }
}

/**
 * Registers the three checks for one scope. `reviewed` maps a file (relative to the workspace root)
 * to its reasons, sorted; a template literal's `${...}` parts read as `*`.
 */
export function describeSystemEntries(name: string, scanned: readonly string[], reviewed: Record<string, string[]>): void {
  describe(`${name} system entry points`, () => {
    const { entries, unnamed } = scanSystemEntries(scanned)

    it('name a literal reason', () => {
      expect(unnamed).toEqual([])
    })

    it('are exactly the reviewed list (PERMISSIONS 11.5)', () => {
      expect(entries).toEqual(reviewed)
    })

    it('say whose work they are (`<area or component>: <job>`)', () => {
      const bad = Object.values(reviewed).flat().filter((r) => !/^[a-z][a-z-]*( [a-z]+)?: \S/.test(r))
      expect(bad).toEqual([])
    })
  })
}
