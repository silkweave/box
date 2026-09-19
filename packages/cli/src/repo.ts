// The Box checkout this file lives in. One definition, because the depth from a source file to the
// repository root is exactly the kind of constant that goes wrong silently when a file moves: five
// scripts each carried their own `resolve(dirname(...), '..')` until they moved into this package
// on 2026-09-17.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `<checkout>` - three levels up from `packages/cli/src/`. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Was this module the file Node was asked to run? The CLI guard every tool here uses. */
export const isMain = (url: string): boolean =>
  resolve(process.argv[1] ?? '') === fileURLToPath(url)

/**
 * A Box checkout: a server package and a core package, both present. One definition, imported by
 * `box`'s target resolution and its CLI tests.
 *
 * WHY NOT `pnpm-workspace.yaml` + `apps/server/`, which this was until 2026-09-18. That asks "is
 * this a pnpm workspace with a server directory in it", and two real trees answer wrongly:
 *
 *   - **a feature source repository matches, and is not a Box.** Its `features/<id>/server` is the
 *     TRUTH for the published apps, not a server, and it declares none of box's toolchain on
 *     purpose. So `box` resolved the PUBLISHING repo as the Box and died on a missing
 *     `@swc-node/register` - and a `box` that mis-targets is worse than one that refuses, because
 *     `db restore` and other Box commands write to whatever this returns.
 *   - **box-apps' `box/` submodule is a Box and did not match**, because box-apps hides
 *     `box/pnpm-workspace.yaml` with sparse-checkout so that pnpm can never find a second workspace
 *     root there. The one tree in that pair which builds and boots was the one tree `box` could not
 *     see, from anywhere.
 *
 * Two package manifests are the honest test: a Box has both, a repo that merely holds app source
 * has neither, and a random pnpm monorepo still does not match. It is deliberately a shape test and
 * not a name test - a team's Box is their fork, and may rename anything but its layout.
 */
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
