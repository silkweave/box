// `box` - the one command for a running Box. `../bin/box` is the shim that gets you here.
//
//   box auth token <id> [--name "Full Name"] [--create] [--rotate] [--admin] [--quiet]
//   box auth link <id>                        short-lived, single-use sign-in link
//   box auth reveal <id>                      re-print an existing access token, breaking nothing
//   box db backup | restore [name] | list | snapshot [name]
// //   box tools                                 browse and invoke the MCP tools interactively
//   box where                                 which Box am I pointed at, and why
//   box <tool-name> [...]                     anything else: the MCP proxy (./mcp-proxy.ts)
//
// TWO TIERS, AND ONLY ONE OF THEM IS HERE. `box` is the team's command: `auth`, `db`, `tools`,
// `where`, and the tool fall-through. Repository maintenance commands are separate package
// scripts, deliberately NOT reachable as a `box` verb. `box` is what a team types, and every verb
// added here widens the collision surface with the unrecognised-verb fall-through below.
//
// WHY THE PROXY IS STILL A CHILD PROCESS. `mcp-proxy.ts` is next door now, so an import would be
// legal - but the proxy must run with the TARGET Box's cwd and node_modules, which is the whole
// point of resolving a target at all. A process boundary gives that for free, keeps DuckDB out of
// the proxy's import graph (`mcp-proxy.test.ts` asserts it), and keeps every `AGENT.md` that says
// `pnpm cli <Tool>` working.
//
// THE FALL-THROUGH IS THE POINT. An unknown verb is an MCP tool name, so `box IngestGithub` works
// the day a feature adds that tool, with no change here. The cost is that a typo becomes a tool
// call; the proxy answers "unknown tool" and that is a fine place to land.
//
// WHICH BOX. Walk up from where you were standing (BOX_INVOKED_FROM, set by the shim) for a
// checkout, and only if there is none fall back to the checkout that registered the shim - saying
// so, out loud, because that is the surprising case. A second Box on server.port=8191 is a first-class
// situation here (read the incident note at the top of apps/server/src/agent/loopback-guard.ts),
// and a CLI that silently meant "the one I was installed from" would be the same mistake wearing a
// different hat.
//
// NO BUILD. Node strips the types itself, so this file and its siblings run as they are. The
// server's scripts still need `--import @swc-node/register/esm-register`: they reach into
// packages/core, whose Nest decorators are not erasable syntax. Those children run with the target
// Box as their cwd, so the loader and the code both come out of THAT Box's node_modules.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findBoxRoot, isBoxRoot, isMain, repoRoot } from './repo.ts'

const selfRoot = repoRoot

const die = (msg: string): never => {
  console.error(`[box] ${msg}`)
  process.exit(1)
}
const note = (msg: string) => console.error(`[box] ${msg}`)

/** The Box this invocation acts on, and the one-line reason, for `box where` and for the warning. */
function target(): { root: string; why: string } {
  const from = process.env.BOX_INVOKED_FROM ?? process.cwd()
  const found = findBoxRoot(from)
  if (found) return { root: found, why: `you are inside it (${from})` }
  if (!isBoxRoot(selfRoot)) die(`${selfRoot} is not a Box checkout, and neither is anything above ${from}`)
  return { root: selfRoot, why: 'the checkout that registered the `box` shim' }
}

/**
 * Run one of the target Box's scripts, through ITS loader.
 *
 * The `--import` specifier stays BARE and the child's cwd is the target root, because node resolves
 * a bare `--import` against the process cwd - so a `box` run inside a second Box loads that Box's
 * @swc-node and runs that Box's code, which is the whole point of resolving a target at all. The
 * obvious-looking alternative, resolving the specifier here with `createRequire`, does not work:
 * `@swc-node/register`'s exports map exposes `./esm-register` under the `import` condition only, so
 * CJS resolution cannot see it at all (checked, 2026-09-15). Hence the existence check below rather
 * than a resolve in a try/catch - it is there to turn a missing install into a sentence instead of
 * a node stack trace.
 */
function runScript(root: string, script: string, args: string[], conditions = false): never {
  if (!existsSync(join(root, 'node_modules', '@swc-node', 'register')))
    die(`${root} is not installed - run \`pnpm install\` there first`)
  const file = join(root, script)
  if (!existsSync(file)) die(`${root} has no ${script} (is it an older Box?)`)
  const flags = conditions ? ['--conditions=@silkweave/box-source'] : []
  const res = spawnSync(
    process.execPath,
    [...flags, '--import', '@swc-node/register/esm-register', file, ...args],
    { cwd: root, stdio: 'inherit' },
  )
  process.exit(res.status ?? 1)
}

/** This package's own tooling: plain node, no loader, no conditions, nothing to resolve. */
function runNode(root: string, script: string, args: string[]): never {
  const res = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, stdio: 'inherit' })
  process.exit(res.status ?? 1)
}

const HELP = `box - the Silkweave Box command line

  box auth token <id> [--name "Full Name"] [--create] [--rotate] [--admin] [--quiet]
  box auth link <id>                          short-lived, single-use sign-in link
  box auth reveal <id>                        re-print an access token, breaking nothing
  box db backup                               a safety copy of the warehouse, kept generationally
  box db list                                 every restore point, with its time and size
  box db restore [name]                       restore one over the live warehouse (previous parked)
  box db snapshot [name]                      a named dev seed you own; nothing ever prunes it
  box tools                                   browse and invoke MCP tools interactively
  box where                                   which Box this acts on, and why
  box <tool-name> [args]                      anything else runs as an MCP tool

Tool names are kebab-case (warehouse-backup, ingest-github), and need mcp.token in box.local.json -
"box auth reveal <you>" prints yours, or set mcp.token in the Box's box.local.json.

Anything not listed is an MCP tool name, so it grows with the features you install.
`

const AUTH = { token: 'auth-token.ts', link: 'auth-link.ts', reveal: 'auth-reveal.ts' } as const
// `seeds` stays as an alias for `list` so older AGENT recipes and muscle memory keep working.
const DB = { backup: 'backup', list: 'list', seeds: 'list', restore: 'restore', snapshot: 'snapshot' } as const

function main(argv: string[]): void {
  const [verb, ...rest] = argv
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    process.stdout.write(HELP)
    return
  }

  const { root, why } = target()

  if (verb === 'where') {
    console.log(root)
    note(why)
    return
  }
  // Said out loud only when it is the surprising answer. Inside a Box, the answer is obvious and a
  // line of chatter on every command is how people learn to stop reading them.
  if (root === selfRoot && !findBoxRoot(process.env.BOX_INVOKED_FROM ?? process.cwd())) {
    note(`no Box above ${process.env.BOX_INVOKED_FROM ?? process.cwd()} - acting on ${root}`)
  }

  if (verb === 'auth') {
    const [sub, ...args] = rest
    const script = AUTH[sub as keyof typeof AUTH]
    if (!script) die(`box auth ${sub ?? ''} - expected one of: ${Object.keys(AUTH).join(', ')}`)
    runScript(root, join('apps/server/scripts', script), args, true)
  }

  if (verb === 'db') {
    const [sub, ...args] = rest
    const mode = DB[sub as keyof typeof DB]
    if (!mode) die(`box db ${sub ?? ''} - expected one of: ${Object.keys(DB).join(', ')}`)
    runScript(root, 'apps/server/scripts/db-snapshot.ts', [mode, ...args], true)
  }

  // `tools` is the proxy with NO arguments, which is its interactive browser. It needs its own verb
  // because bare `box` prints help: the proxy's list is the thing you want when you do not yet know
  // a tool's name, and "run the CLI with no arguments" is not discoverable from a help screen.
  if (verb === 'tools') runNode(root, 'packages/cli/src/mcp-proxy.ts', rest)

  // Everything else is an MCP tool. The proxy is the target Box's, so it talks to the port that
  // Box serves and authenticates with the token in that Box's box.local.json.
  runNode(root, 'packages/cli/src/mcp-proxy.ts', [verb, ...rest])
}

// Guarded so the target resolution above is importable by its test; the shim runs this file
// directly, so `isMain` is true there.
if (isMain(import.meta.url)) main(process.argv.slice(2))
