// Shared filesystem helpers. Two roots matter: the CHECKOUT root (marked by AGENTS.md - holds the
// code) and the BOX INSTANCE dir (`data/` - box.json, config/, docs/ and the warehouse). Everything
// instance-specific resolves under `instanceDir()`, and every caller resolves it when it runs, never
// at module scope: that is what lets one process be pointed somewhere else before it looks.
//
// A Box is a checkout plus its `data/`; a throwaway Box is a second checkout. The one legitimate
// redirect for typegen and tests is an in-process
// call, `setInstanceDir()` from `@silkweave/box-core/testing`, which a shell cannot leak in and an
// adopted app cannot reach through the public index.

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBoxConfig } from './box-json.js'

/** Walk up from this file until we find the checkout root (marked by AGENTS.md). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'AGENTS.md'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('repoRoot: could not locate AGENTS.md walking up from ' + import.meta.url)
}

let override: string | undefined

/**
 * The BOX INSTANCE dir - `<repoRoot>/data`: holds `box.json`, `config/`, `docs/` and the DuckDB
 * warehouse (`data.db`). Gitignored, so the checkout stays free of any one Box's data.
 *
 * A test redirects with `setInstanceDir()` from `@silkweave/box-core/testing`.
 */
export function instanceDir(): string {
  return override ?? join(liveRoot(), 'data')
}

/** Root configuration directory. Tests redirect this with setInstanceDir without touching the real checkout. */
export function configRoot(): string { return override ?? repoRoot() }

/**
 * The checkout root, for reaching the LIVE instance data. Under a test runner it refuses: a test that
 * has not redirected with setInstanceDir would read and write the real Box. That happened when a
 * feature's tests ran from a config that loaded a second copy of core (setInstanceDir landed on one
 * copy, the code under test used the other), and when feature core tests ran under `bun test`, which
 * sets no VITEST: both runs migrated and overwrote a production warehouse. Vitest sets VITEST and
 * `bun test` sets NODE_ENV=test; nothing that serves a Box runs with either.
 */
function liveRoot(): string {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    throw new Error(
      'Refusing to use the live Box instance under a test runner: call setInstanceDir() from ' +
        '@silkweave/box-core/testing first, and run feature tests through packages/core or apps/server ' +
        'so every core import resolves to one module (docs/GOTCHAS.md).',
    )
  }
  return repoRoot()
}

/**
 * Point THIS process at another instance directory, for typegen and tests. Absolute paths only.
 * Call it before anything reads the instance, which - because every read is lazy - means before
 * the code that reads is called, not before it is imported. Not on the public index on purpose:
 * a running Box re-pointed mid-flight is one Box split across two directories.
 */
export function setInstanceDir(dir: string): void {
  if (!isAbsolute(dir)) throw new Error(`setInstanceDir: expected an absolute path, got ${JSON.stringify(dir)}`)
  override = dir
}

/** Forget a `setInstanceDir()`; the process is back on `<repoRoot>/data`. */
export function resetInstanceDir(): void {
  override = undefined
}

/** Absolute path to an instance config file, e.g. `configPath('accounts.json')`. */
export function configPath(name: string): string {
  return join(instanceDir(), 'config', name)
}

/** The instance docs root (`<instance>/docs`) - initiatives, content, sink, etc. */
export function docsDir(): string {
  return join(instanceDir(), 'docs')
}

/** The DuckDB warehouse file (`<instance>/data.db`) - the ground truth. */
export function warehousePath(): string {
  return join(instanceDir(), 'data.db')
}

/** Join an arbitrary path under the Box instance dir (e.g. evidence/backup scratch). */
export function dataPath(...parts: string[]): string {
  return join(instanceDir(), ...parts)
}

/** Display an instance path relative to the instance dir (stable `docs/initiatives/...` form). */
export function instanceRelative(abs: string): string {
  return relative(instanceDir(), abs)
}

/**
 * A `vscode://…` deep link that opens `abs` in VS Code from the dashboard. A Box usually runs on
 * another machine with the dashboard viewed remotely in a browser, so set `server.vscodeRemoteHost`
 * (or `VSCODE_REMOTE_HOST`) to an ssh host (e.g. `box`, or `you@box` if your ssh config needs the
 * user) to emit a Remote-SSH link that opens the file over that connection; unset, it falls back to
 * a local-file link. The trailing `:1:1` (line:col) is required - VS Code won't open the remote
 * target without a position fragment.
 *
 * It lives HERE, beside filesystem helpers, because four reference apps
 * (crm, content, planning, sink) import it as `../../io.js`. An app reaches into core by relative
 * path, so core's module layout is part of what an adopted app depends on: moving this symbol
 * broke all four on 2026-09-18 and there is no downstream fix for an adopted app. Reading through
 * `box-json.ts` rather than `box-config.ts` keeps this module free of a cycle - box-json imports
 * nothing but `node:fs` and `node:path`.
 */
export function editorUri(abs: string): string {
  const host = readBoxConfig().server.vscodeRemoteHost
  return host ? `vscode://vscode-remote/ssh-remote+${host}${abs}:1:1` : `vscode://file${abs}:1:1`
}
