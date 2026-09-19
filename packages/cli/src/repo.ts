// The Box checkout this file lives in. One definition, because the depth from a source file to the
// repository root is exactly the kind of constant that goes wrong silently when a file moves: five
// scripts each carried their own `resolve(dirname(...), '..')` until they moved into this package
// on 2026-09-17.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `<checkout>` - three levels up from `packages/cli/src/`. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Was this module the file the runtime was asked to run? The CLI guard every tool here uses. */
export const isMain = (url: string): boolean =>
  resolve(process.argv[1] ?? '') === fileURLToPath(url)

/** A Box has actual server and core packages, not merely workspace or feature directories. */
export const isBoxRoot = (dir: string): boolean =>
  existsSync(join(dir, 'apps', 'server', 'package.json')) && existsSync(join(dir, 'packages', 'core', 'package.json'))

/** The nearest Box checkout at or above `from`, or null when there is none. */
export function findBoxRoot(from: string): string | null {
  let dir = resolve(from)
  for (;;) {
    if (isBoxRoot(dir)) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}
