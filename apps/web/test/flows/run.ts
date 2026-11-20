// Gate C: replays UI transitions that broke before against this checkout's RUNNING dev Box (it never
// starts or stops a server). Signs each principal in once with a `box auth login` link, then runs
// every `*.spec.ts` beside this file in its own fresh browser context. Exit code 0 only when every
// spec passed.
//
//   bun run test:flows                 every spec, against http://localhost:8190
//   bun run test:flows <filter>        only specs whose name matches the regex
//   bun run test:flows --base=<url>    another running Box of this checkout
//
// An unreachable Box or a missing browser is a FAILED gate, never a skip: nothing was checked.
// Each spec context starts from the sign-in's storage, so local view state a spec changes is thrown
// away with its context; server records it creates are deleted by its own cleanup.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser, type BrowserContextOptions } from 'playwright-core'
import { PRINCIPALS, SpecFailure, type FlowContext, type FlowSpec, type Principal } from './harness.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '../../../..')
const args = process.argv.slice(2)
const base = (args.find((a) => a.startsWith('--base='))?.slice('--base='.length) ?? 'http://localhost:8190').replace(/\/$/, '')
const filter = args.find((a) => !a.startsWith('--'))
const started = Date.now()
const redact = (s: string): string => s.replace(/\/login\/[^\s'"]+/g, '/login/<redacted>')

try {
  const res = await fetch(base, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
} catch (err) {
  console.error(`flows: FAILED, no Box answers at ${base} (${String(err)}).\nStart this checkout's dev Box with \`box dev\` first; the gate never starts one itself.`)
  process.exit(1)
}

const specs: FlowSpec[] = []
for (const f of readdirSync(here).filter((f) => f.endsWith('.spec.ts')).sort()) {
  const mod = (await import(pathToFileURL(join(here, f)).href)) as { specs: FlowSpec[] }
  specs.push(...mod.specs)
}
const chosen = specs.filter((s) => !filter || new RegExp(filter).test(s.name))

let browser: Browser
try {
  browser = await chromium.launch({ headless: true })
} catch (err) {
  console.error(`flows: FAILED, no headless Chromium to run in (${String(err).split('\n')[0]}).\nInstall it once with: bunx playwright-core install chromium-headless-shell`)
  process.exit(1)
}

/** Signs `who` in through a fresh single-use link and returns that context's storage. */
async function signIn(who: Principal): Promise<BrowserContextOptions['storageState']> {
  const id = PRINCIPALS[who]
  const r = spawnSync('box', ['auth', 'login', id], { cwd: repo, encoding: 'utf8' })
  const link = /https?:\/\/\S+\/login\/\S+/.exec(`${r.stdout}\n${r.stderr}`)?.[0]
  if (r.status !== 0 || !link) throw new SpecFailure(`box auth login ${id} gave no sign-in link (exit ${r.status}): ${redact(`${r.stdout}${r.stderr}`).trim().split('\n').slice(0, 3).join(' / ')}`)
  // The link names the Vite port; sign in on the Box under test so its origin owns the session.
  const url = new URL(link)
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`${base}${url.pathname}${url.search}`)
    // A GET never spends a grant: the link shows "Continue as <id>" and the click signs in.
    const go = page.getByRole('button', { name: /^Continue( as .*)?$/ })
    await go.waitFor({ timeout: 20000 })
    await go.click()
    await page.locator('main').first().waitFor({ timeout: 20000 })
    const signedIn = async (): Promise<boolean> => (await page.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin' }).then((x) => x.text(), () => ''))).includes(`"${id}"`)
    const until = Date.now() + 10000
    while (!(await signedIn())) {
      if (Date.now() > until) throw new SpecFailure(`signing in as ${id} did not stick`)
      await new Promise((ok) => setTimeout(ok, 250))
    }
    return await context.storageState()
  } catch (err) {
    throw new SpecFailure(`sign-in as ${id} failed: ${redact(String(err instanceof Error ? err.message : err))}`)
  } finally {
    await context.close()
  }
}

// The Box limits API calls (/api, /trpc, /mcp) to 600 a minute per client address, and every local
// browser and agent shares this machine's address. A spec that ran into the limit would fail on
// whatever it was doing (the app even falls back to the sign-in form when its session probe is
// refused), so the gate keeps its own calls of the last minute, this run's and the previous run's
// (kept in a temp file), under half the limit, pausing between specs.
const API_BUDGET = 300
const API_PATH = /^\/(api|trpc|mcp)(\/|$)/
const apiLog = join(tmpdir(), 'gate-c', 'api-calls.json')
const apiCalls: number[] = (() => {
  try {
    return (JSON.parse(readFileSync(apiLog, 'utf8')) as number[]).filter((t) => t > Date.now() - 60_000)
  } catch {
    return []
  }
})()
let apiTotal = 0
async function paceApi(): Promise<void> {
  for (;;) {
    while (apiCalls.length && apiCalls[0] < Date.now() - 60_000) apiCalls.shift()
    if (apiCalls.length < API_BUDGET) return
    const wait = apiCalls[0] + 60_000 - Date.now() + 100
    if (wait > 1000) console.log(`  ...   pausing ${(wait / 1000).toFixed(0)}s to stay under the Box's API rate limit`)
    await new Promise((ok) => setTimeout(ok, wait))
  }
}

const sessions = new Map<Principal, BrowserContextOptions['storageState']>()
const failures: string[] = []
let passed = 0
for (const spec of chosen) {
  const who = spec.as ?? 'admin'
  const label = `[${who}] ${spec.name}`
  const t0 = Date.now()
  const cleanups: (() => Promise<unknown>)[] = []
  let context: Awaited<ReturnType<Browser['newContext']>> | null = null
  const errors: string[] = []
  try {
    await paceApi()
    if (!sessions.has(who)) sessions.set(who, await signIn(who))
    context = await browser.newContext({ storageState: sessions.get(who), viewport: spec.viewport ?? { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    context.on('request', (r) => {
      if (!API_PATH.test(new URL(r.url()).pathname)) return
      apiCalls.push(Date.now())
      apiTotal++
    })
    context.on('response', (r) => {
      if (r.status() === 429) errors.push(`the Box rate-limited ${new URL(r.url()).pathname} (429)`)
    })
    const ctx: FlowContext = {
      page,
      context,
      base,
      open: async (path) => {
        await page.goto(`${base}${path}`)
        await page.locator('main').first().waitFor({ timeout: 20000 })
      },
      cleanup: (fn) => void cleanups.push(fn),
    }
    try {
      await spec.run(ctx)
    } finally {
      for (const fn of cleanups.reverse()) {
        try {
          await fn()
        } catch (err) {
          errors.push(`cleanup failed: ${String(err)}`)
        }
      }
    }
    if (errors.length) throw new SpecFailure(`page errors: ${errors.splice(0).join('; ')}`)
    passed++
    console.log(`  ok    ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (err) {
    // What the page showed when it failed, for the person reading the report.
    const shot = join(tmpdir(), 'gate-c', `${spec.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}.png`)
    const saved = await context?.pages()[0]?.screenshot({ path: shot }).then(() => true, () => false)
    // A dev Box restarting under the run (a server source edit) fails specs that are not at fault.
    const up = await fetch(`${base}/api/auth/me`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false)
    // The token form instead of the app: the session probe failed (the cookie cannot expire), which
    // happens while the dev server restarts.
    const gate = (await context?.pages()[0]?.getByPlaceholder('Access token', { exact: true }).count().catch(() => 0)) ?? 0
    const seen = errors.length ? ` (page errors: ${[...new Set(errors)].join('; ')})` : ''
    const why = seen + (!up ? ' (the Box did not answer afterwards: it may have been restarting)' : gate ? ' (the page fell back to the sign-in form: the session probe failed: a dev server restart or the API rate limit)' : '')
    failures.push(`${label}: ${redact(err instanceof SpecFailure ? err.message : String(err))}${saved ? ` (screenshot: ${shot})` : ''}${why}`)
    console.log(`  FAIL  ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } finally {
    await context?.close()
  }
}
await browser.close()
mkdirSync(dirname(apiLog), { recursive: true })
writeFileSync(apiLog, JSON.stringify(apiCalls.filter((t) => t > Date.now() - 60_000)))

console.log(`\nflows: ${passed} passed, ${failures.length} failed (${chosen.length} specs, ${((Date.now() - started) / 1000).toFixed(1)}s, ${apiTotal} API calls, ${base})`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(failures.length || chosen.length === 0 ? 1 : 0)
