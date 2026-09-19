// Regenerate apps/web/src/generated/appRouter.d.ts WITHOUT booting a server (docs/core/SEAM.md § 6.2).
//
// Until this existed, `appRouter.d.ts` only changed when someone ran the server: a controller edit
// plus `pnpm typecheck` type-checked the web app against a STALE router, so a renamed or deleted
// procedure passed verify and broke in the browser. `pnpm typegen` is now part of `pnpm verify`,
// ahead of `typecheck`, so the web project always type-checks against the router it will get.
//
// How it works, and the two facts it rests on:
//
//  1. The silkweave adapters register in `SilkweaveModule.configure()` - the NestModule middleware
//     hook - which Nest calls during `app.init()`. `listen()` is NOT needed, so nothing binds a
//     port and nothing can collide with a running Box. (A second Box still needs PORT and
//     BOX_VITE_PORT set explicitly - see apps/server/src/agent/loopback-guard.ts.)
//  2. The typegen adapter's `register()` is FIRE-AND-FORGET: it kicks off an async import + write
//     and returns immediately (see @silkweave/nestjs/build/typegen.mjs). So `init()` resolving does
//     not mean the file is on disk - this script waits for the write itself, and fails loudly on a
//     timeout rather than leaving a stale file behind a green check.
//
// Everything that could arm is disabled and the process is pointed at a throwaway instance dir
// (`setInstanceDir`, the in-process seam that replaced the BOX_DATA_DIR variable on 2026-09-18), so
// a run never touches the real warehouse, never starts the scheduler, the chat agent, the relay or
// workerdeck. It runs inside `prepare`, on every `pnpm install`: this is the guarantee that makes
// that safe.
//
//   pnpm typegen           regenerate in place
//   pnpm typegen --check   fail if the generated file is not already up to date (CI / pre-commit);
//                          the file is restored, so a --check run never dirties the tree.
//   pnpm typegen --quiet   drop Nest's WARN level. The silkweave adapter warns once per procedure
//                          whose output it could only reflect one level deep (~50 lines, constant,
//                          nothing to act on today). That is tolerable in `pnpm verify` and NOT in
//                          the root `prepare`, which runs on every `pnpm install`: a fresh clone
//                          greeting a new user with fifty yellow WARNs teaches them to stop reading
//                          the output, and this repo already made that argument once about a 404
//                          favicon (apps/web/index.html).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const check = process.argv.includes('--check')
const quiet = process.argv.includes('--quiet')

// Type generation owns a disposable instance with default-disabled background work.
const dataDir = mkdtempSync(join(tmpdir(), 'box-typegen-'))
mkdirSync(join(dataDir, 'config'), { recursive: true })

async function main(): Promise<number> {
  // Redirect the instance dir BEFORE AppModule is imported. Every instance read in core and the
  // server is lazy (inside a function), so a setter called here has the same ordering guarantee the
  // environment variable had, and unlike the variable it cannot arrive from a shell.
  const { setInstanceDir } = await import('@silkweave/box-core/testing')
  setInstanceDir(dataDir)
  const { NestFactory } = await import('@nestjs/core')
  const { ControllerDiscovery } = await import('@silkweave/nestjs')
  const { repoRoot } = await import('@silkweave/box-core')
  const { AppModule } = await import('../src/app.module.js')

  const target = join(repoRoot(), 'apps', 'web', 'src', 'generated', 'appRouter.d.ts')
  const before = existsSync(target) ? readFileSync(target, 'utf-8') : undefined
  // Remove the target first, so "the adapter wrote it" is a file-EXISTS question. Polling on
  // content cannot answer it: the common case is a byte-identical rewrite, indistinguishable from
  // no write at all. `before` is restored below if the write never lands.
  rmSync(target, { force: true })

  const app = await NestFactory.create(AppModule, { logger: quiet ? ['error'] : ['error', 'warn'], abortOnError: false })
  await app.init()

  // Wait for the adapter's async write (fact 2 above).
  const deadline = Date.now() + 30_000
  while (!existsSync(target) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
  if (!existsSync(target)) {
    if (before !== undefined) writeFileSync(target, before, 'utf-8')
    await app.close().catch(() => undefined)
    console.error(`typegen: the adapter wrote nothing to ${target} within 30s`)
    return 1
  }
  const after = readFileSync(target, 'utf-8')

  // The two flat namespaces (§ 6.2). A method carrying both decorators yields TWO actions that
  // share a name - one gated to `mcp`, one to `trpc`/`typegen` - so a duplicate is only a collision
  // WITHIN one adapter's list. That is the list each transport actually registers: a clash there
  // silently shadows one action at runtime and drops a key from the generated router.
  const actions = app.get(ControllerDiscovery, { strict: false }).discover({})
  // The shape `isEnabled` reads - `ctx.getOptional('adapter')` is all of the context it touches.
  const asAdapter = (adapter: string) => ({ getOptional: (k: string) => (k === 'adapter' ? adapter : undefined) })
  const clashes: string[] = []
  for (const adapter of ['mcp', 'trpc'] as const) {
    const ctx = asAdapter(adapter) as never
    const seen = new Map<string, number>()
    for (const a of actions.filter((x) => !x.isEnabled || x.isEnabled(ctx))) seen.set(a.name, (seen.get(a.name) ?? 0) + 1)
    for (const [name, n] of seen) if (n > 1) clashes.push(`${adapter}: ${name} (x${n})`)
  }

  await app.close().catch(() => undefined)

  if (clashes.length) {
    console.error(`typegen: duplicate action name(s):\n  ${clashes.join('\n  ')}`)
    return 1
  }

  if (check && before !== after) {
    if (before === undefined) rmSync(target, { force: true })
    else writeFileSync(target, before, 'utf-8')
    console.error(`typegen --check: ${target} is stale. Run \`pnpm typegen\` and commit the result.`)
    return 1
  }
  console.info(`typegen: ${actions.length} actions, ${before === after ? 'unchanged' : 'rewrote'} ${target}`)
  return 0
}

main()
  .then((code) => {
    rmSync(dataDir, { recursive: true, force: true })
    // Explicit: DuckDB handles, timers and the express server keep the loop alive past app.close().
    process.exit(code)
  })
  .catch((err) => {
    rmSync(dataDir, { recursive: true, force: true })
    console.error('typegen failed:', err)
    process.exit(1)
  })
