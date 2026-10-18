// The public Box command. Resolve the target checkout before launching its own source.
// Explicit lifecycle verbs take precedence; other names retain the MCP tool fallback.
// Bun executes TypeScript and Nest decorators directly, without a runtime loader.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findBoxRoot, isBoxRoot, isMain, repoRoot } from './repo.ts'
import { commandError, commandHeader, commandNotice } from './command-ui.ts'

const selfRoot = repoRoot

const die = (msg: string): never => {
  commandError(msg)
  process.exit(1)
}
const note = (msg: string) => commandNotice(msg)

/** The Box this invocation acts on, and the one-line reason, for `box where` and for the warning. */
function target(): { root: string; why: string } {
  const from = process.env.BOX_INVOKED_FROM ?? process.cwd()
  const found = findBoxRoot(from)
  if (found) return { root: found, why: `you are inside it (${from})` }
  if (!isBoxRoot(selfRoot)) die(`${selfRoot} is not a Box checkout, and neither is anything above ${from}`)
  return { root: selfRoot, why: 'the checkout that registered the `box` shim' }
}

/** Run the selected checkout's source, preserving its configuration and dependencies. */
function runScript(root: string, script: string, args: string[], conditions = false): never {
  const file = join(root, script)
  if (!existsSync(file)) die(`${root} has no ${script} (is it an older Box?)`)
  const flags = conditions ? ['--conditions=@silkweave/box-source'] : []
  const result = spawnSync(process.execPath, ['--no-env-file', '--no-orphans', ...flags, file, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) die(result.error.message)
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1))
}

/** Invoke a package script explicitly: `bun build` would select Bun's bundler. */
function runPackage(root: string, script: string, args: string[]): never {
  const result = spawnSync(process.execPath, ['--bun', '--no-env-file', '--no-orphans', 'run', script, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) die(result.error.message)
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1))
}

const HELP = `  box dev [--log-level <level>]              start interactive development
  box setup [options]                         create the first owner and configure providers
  box build                                  build workspace packages and the application
  box app status [--json]                     app state, mode (dev or built) and frontend state
  box app restart                             restart the app; preserve supervisor and Builder
  box app restart --frontend                  restart the Vite dev server (box dev, or a Builder session)
  box app promote                             typecheck, build and publish the web release (box start)
  box builder refresh                        refresh Builder UI without restarting its session
  box builder browser --session <session-id> <operation> [JSON object]
  box start                                  start the Box: promoted web release, Vite for Builder Preview
  box start --prod                           start the production build
  box verify [--plain|--verbose]              run the complete visual validation chain
  box auth token <id> [--name "Full Name"] [--create] [--rotate] [--admin] [--quiet]
  box auth login <id>                         short-lived, single-use browser sign-in
  box auth reveal <id>                        re-print an access token, breaking nothing
  box auth replace <old> <new> [--name "Name"] a new agent takes over an agent's config; the old one retires
  box db backup                               a safety copy of the warehouse, kept generationally
  box db list                                 every restore point, with its time and size
  box db restore [name] [--keep-agent-files]  restore one (warehouse + agent files) over the live Box (previous parked)
  box db snapshot [name]                      a named dev seed you own; nothing ever prunes it
  box tools                                   browse and invoke MCP tools interactively
  box where                                   which Box this acts on, and why
  box stack where                             the configured Stack source and where it resolves
  box stack fetch [--ref <rev>] [--quiet]     make Stack source readable locally; print path and commit
  box <tool-name> [args]                      anything else runs as an MCP tool

Tool names are kebab-case (warehouse-backup, ingest-github), and need mcp.token in box.local.json -
"box auth reveal <you>" prints yours, or set mcp.token in the Box's box.local.json.

Anything not listed is an MCP tool name, so it grows with the features you install.
`
const DEV_HELP = `  box dev [--log-level <level>] [--plain]

  Levels: error, warn, info (default), verbose, debug
  Aliases: --verbose, --debug

  Live keys: ↑/↓ scroll · v verbosity · r restart app · f restart frontend · c clear · q quit
  Vite hot module replacement remains automatic.
`

const AUTH = { token: 'auth-token.ts', login: 'auth-login.ts', reveal: 'auth-reveal.ts', replace: 'auth-replace.ts' } as const
// `seeds` stays as an alias for `list` so older AGENT recipes and muscle memory keep working.
const DB = { backup: 'backup', list: 'list', seeds: 'list', restore: 'restore', snapshot: 'snapshot' } as const

function main(argv: string[]): void {
  const [verb, ...rest] = argv
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    commandHeader('help')
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

  if (verb === 'builder') {
    if (rest.length === 1 && rest[0] === 'refresh') runScript(root, 'packages/cli/src/builder-refresh.ts', [])
    if (rest[0] === 'browser') runScript(root, 'packages/cli/src/builder-browser.ts', rest.slice(1))
    die('Expected: box builder refresh or box builder browser --session <id> <operation> [JSON]')
  }

  if (verb === 'stack') runScript(root, 'packages/cli/src/stack.ts', rest)

  if (verb === 'app') runScript(root, 'packages/cli/src/app-control.ts', rest)

  if (verb === 'verify') runScript(root, 'packages/cli/src/verify.ts', rest)
  if (verb === 'setup') runScript(root, 'apps/server/scripts/setup.ts', rest, true)
  if (verb === 'dev') {
    if (rest.includes('--help') || rest.includes('-h')) { commandHeader('dev'); process.stdout.write(DEV_HELP); return }
    runPackage(root, verb, rest)
  }
  if (verb === 'build') { if (process.stdout.isTTY) commandHeader('build'); runPackage(root, verb, rest) }
  if (verb === 'start') {
    if (process.stdout.isTTY) commandHeader(rest.includes('--prod') ? 'start / production' : 'start')
    runPackage(root, rest.includes('--prod') ? 'start:prod' : 'start', rest.filter(arg => arg !== '--prod'))
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
  if (verb === 'tools') runScript(root, 'packages/cli/src/mcp-proxy.ts', rest)

  // Everything else is an MCP tool. The proxy is the target Box's, so it talks to the port that
  // Box serves and authenticates with the token in that Box's box.local.json.
  runScript(root, 'packages/cli/src/mcp-proxy.ts', [verb, ...rest])
}

// Guarded so the target resolution above is importable by its test; the shim runs this file
// directly, so `isMain` is true there.
if (isMain(import.meta.url)) main(process.argv.slice(2))
