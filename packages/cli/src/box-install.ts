#!/usr/bin/env bun
// Put `box` on PATH.
//
//   bun run box:install            symlink ~/.local/bin/box -> <this checkout>/packages/cli/bin/box
//   bun run box:install --check    report what is installed, change nothing
//   bun run box:install --remove   take the link away again
//
// A SYMLINK, not a copy and not a `bin` in package.json. The same argument as `bun run skills`: a copy
// is a second source of truth that rots the moment someone edits the real one. And a `bin` would
// mean `bun link --global`, whose target directory depends on the installation - this
// is one predictable path a person can see, delete, or point somewhere else.
//
// It only ever REPLACES a link that already points into a Box checkout. A `box` that is a real file,
// or a link to something else entirely, is somebody else's program and this refuses to touch it.
//
// Which Box the command then acts on is NOT decided here: `box` walks up from wherever you run it
// and only falls back to this checkout (packages/cli/src/index.ts). So registering a second Box's shim is a
// change of default, not a change of meaning, and the first Box keeps working from inside itself.

import type { Stats } from 'node:fs'
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { repoRoot, isBoxRoot } from './repo.ts'

const root = repoRoot
const source = join(root, 'packages', 'cli', 'bin', 'box')
const binArg = process.argv.find(arg => arg.startsWith('--bin-dir='))?.slice('--bin-dir='.length)
const binDir = binArg ? resolve(binArg) : join(homedir(), '.local', 'bin')
const link = join(binDir, 'box')

const check = process.argv.includes('--check')
const remove = process.argv.includes('--remove')

const die = (msg: string) => {
  console.error(`[box-install] ${msg}`)
  process.exit(1)
}

/** The Box checkout a shim path sits inside, if any: up to four levels above `<...>/bin/box`. */
function checkoutAbove(shim: string): string | null {
  let dir = dirname(shim)
  for (let i = 0; i < 4; i++) {
    dir = dirname(dir)
    if (isBoxRoot(dir)) return dir
  }
  return null
}

/**
 * What is at `link` today. `detail` is the sentence printed about a link this refuses to touch, so
 * only `foreign` carries one; the other shapes declare its absence rather than leaving it open.
 */
type Existing =
  | { kind: 'absent' }
  | { kind: 'ours'; to: string }
  | { kind: 'otherBox'; to: string; detail?: undefined }
  | { kind: 'foreign'; detail: string; to?: string }

/** What is at `link` today: nothing, our link, another Box's link, or something we must not touch. */
function current(): Existing {
  let st: Stats
  try {
    st = lstatSync(link)
  } catch {
    return { kind: 'absent' }
  }
  if (!st.isSymbolicLink()) return { kind: 'foreign', detail: 'a real file, not a symlink' }
  const to = resolve(binDir, readlinkSync(link))
  if (to === source) return { kind: 'ours', to }
  // Another Box's shim is still OUR shape, so replacing it is a legitimate change of default. The
  // search walks UP rather than assuming a depth, because the shim moved from <root>/bin/box to
  // packages/cli/bin/box on 2026-09-18 and a link registered before that must still be recognised
  // as ours - otherwise the person whose shim now dangles is told it is somebody else's program.
  if (to.endsWith(join('bin', 'box')) && checkoutAbove(to)) return { kind: 'otherBox', to }
  return { kind: 'foreign', detail: `a symlink to ${to}`, to }
}

if (!existsSync(source)) die(`${source} is missing - this is not a complete checkout`)

const now = current()

if (check) {
  if (now.kind === 'ours') console.log(`box: installed at ${link} -> ${source}`)
  else if (now.kind === 'otherBox') console.log(`box: installed at ${link}, but pointing at another Box (${now.to})`)
  else if (now.kind === 'absent') console.log(`box: NOT installed (no ${link})`)
  else console.log(`box: ${link} is ${now.detail} - left alone`)
  process.exit(0)
}

if (remove) {
  if (now.kind === 'ours') {
    rmSync(link)
    console.log(`box: removed ${link}`)
  } else if (now.kind === 'absent') console.log(`box: nothing to remove (no ${link})`)
  else die(`${link} is ${now.detail ?? `pointing at ${now.to}`} - remove it by hand if you mean to`)
  process.exit(0)
}

if (now.kind === 'foreign') die(`${link} is ${now.detail} - refusing to replace it`)
if (now.kind === 'ours') console.log(`box: already installed at ${link}`)
else {
  mkdirSync(binDir, { recursive: true })
  if (now.kind === 'otherBox') rmSync(link)
  symlinkSync(source, link)
  console.log(`box: ${link} -> ${source}${now.kind === 'otherBox' ? ` (was ${now.to})` : ''}`)
}

// The one thing that makes this fail silently: a link nobody's shell will ever look at.
const onPath = (process.env.PATH ?? '').split(':').some((p) => p && resolve(p) === resolve(binDir))
if (!onPath) {
  console.log(`\nbox: ${binDir} is NOT on your PATH. Add this to your shell profile, then reopen the terminal:`)
  console.log(`  export PATH="${binDir}:$PATH"`)
} else {
  console.log('box: run `box help` to check it, `box where` to see which Box it acts on')
}
