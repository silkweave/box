// The rendered gate: builds Storybook, serves the build, and runs every `*.spec.ts` beside this file
// in headless Chromium, in each theme the spec names. Exit code 0 only when every check passed.
//
//   bun run test:rendered                  build, then run every spec
//   bun run test:rendered --no-build       reuse the last build (after a spec-only change)
//   bun run test:rendered <filter>         only specs whose story or name matches the regex
//   bun run test:rendered --accept         write differing screenshots as the new baselines (look
//                                          at the diffs first; a baseline is a reviewed picture)
//
// A missing browser is a FAILED gate, never a skip: rendered output was not checked.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { SpecFailure, type RenderedSpec, type Theme } from './harness.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const pkg = resolve(here, '../..')
const out = join(pkg, 'node_modules/.cache/rendered-storybook')
const args = process.argv.slice(2)
const build = !args.includes('--no-build')
const accept = args.includes('--accept')
const screens = join(here, 'screens')
const diffs = join(pkg, 'node_modules/.cache/rendered-diffs')
// Relative times read "now": every run sees the same moment.
const NOW = new Date('2026-11-20T10:00:00.000Z')
const filter = args.find((a) => !a.startsWith('--'))

if (build || !existsSync(join(out, 'index.json'))) {
  console.log('rendered: building Storybook...')
  const r = spawnSync('bunx', ['storybook', 'build', '--quiet', '--output-dir', out], { cwd: pkg, stdio: ['ignore', 'ignore', 'inherit'] })
  if (r.status !== 0) {
    console.error('rendered: FAILED, Storybook did not build')
    process.exit(1)
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = join(out, path)
  if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
const port = (server.address() as { port: number }).port

const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as { entries: Record<string, { type: string }> }
const specs: RenderedSpec[] = []
for (const f of readdirSync(here).filter((f) => f.endsWith('.spec.ts')).sort()) {
  const mod = (await import(pathToFileURL(join(here, f)).href)) as { specs: RenderedSpec[] }
  specs.push(...mod.specs)
}
const chosen = specs.filter((s) => !filter || new RegExp(filter).test(`${s.story} ${s.name}`))

let browser: Browser
try {
  browser = await chromium.launch({ headless: true })
} catch (err) {
  console.error(`rendered: FAILED, no headless Chromium to run in (${String(err).split('\n')[0]}).\nInstall it once with: bunx playwright-core install chromium-headless-shell`)
  server.close()
  process.exit(1)
}

const failures: string[] = []
const accepted: string[] = []
let passed = 0

/** Pixels whose colour moved by more than a small antialiasing tolerance, compared in a canvas. */
async function compare(page: import('playwright-core').Page, a: Buffer, b: Buffer): Promise<{ changed: number; diff: string; sizeNote: string }> {
  return page.evaluate(async ([a64, b64]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = `data:image/png;base64,${src}` })
    const [ia, ib] = await Promise.all([load(a64), load(b64)])
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height)
    const data = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data }
    const da = data(ia), db = data(ib)
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const ox = out.getContext('2d')!; const od = ox.createImageData(w, h)
    let changed = 0
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]))
      if (d > 24) { changed++; od.data.set([255, 0, 80, 255], i) } else od.data.set([da[i], da[i + 1], da[i + 2], 40], i)
    }
    ox.putImageData(od, 0, 0)
    return { changed, diff: out.toDataURL('image/png').split(',')[1], sizeNote: ia.width !== ib.width || ia.height !== ib.height ? ` (size ${ia.width}x${ia.height} -> ${ib.width}x${ib.height})` : '' }
  }, [a.toString('base64'), b.toString('base64')] as const)
}
for (const spec of chosen) {
  if (!index.entries[spec.story]) {
    failures.push(`${spec.story} :: ${spec.name}: no such story`)
    continue
  }
  for (const theme of spec.themes ?? (['light', 'dark'] as Theme[])) for (const width of spec.widths ?? [1280]) {
    const label = `${spec.story} [${theme} ${width}] ${spec.name}`
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await page.clock.setFixedTime(NOW)
      await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${spec.story}&viewMode=story&globals=theme:${theme}`)
      await page.locator('#storybook-root > *').first().waitFor({ timeout: 15000 })
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      // Pictures (avatars) load on their own schedule: a shot taken before one lands differs.
      await page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 10000 })
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' })
      await spec.run({
        page,
        theme,
        width,
        fixture: async (id) => {
          const l = page.locator(`[data-fixture="${id}"]`)
          const n = await l.count()
          if (n !== 1) throw new SpecFailure(`fixture ${id}: expected exactly one, found ${n}`)
          return l
        },
        screenshot: async (name, target) => {
          const file = `${spec.story}--${name}--${theme}-${width}.png`
          // `data-shot` marks a story's content when the story fills the canvas around it.
          const marked = page.locator('[data-shot]')
          const shot = await (target ?? ((await marked.count()) === 1 ? marked : page.locator('#storybook-root > *').first())).screenshot()
          const base = join(screens, file)
          const write = () => {
            mkdirSync(screens, { recursive: true })
            writeFileSync(base, shot)
            accepted.push(file)
          }
          if (!existsSync(base)) {
            if (accept) return write()
            mkdirSync(diffs, { recursive: true })
            writeFileSync(join(diffs, file), shot)
            throw new SpecFailure(`${file}: no baseline; look at ${join(diffs, file)}, then run with --accept`)
          }
          const res = await compare(page, readFileSync(base), shot)
          if (res.changed === 0) return
          if (accept) return write()
          mkdirSync(diffs, { recursive: true })
          writeFileSync(join(diffs, file), shot)
          writeFileSync(join(diffs, file.replace(/\.png$/, '.diff.png')), Buffer.from(res.diff, 'base64'))
          throw new SpecFailure(`${file}: ${res.changed} pixels differ${res.sizeNote}; new image and diff in ${diffs}`)
        },
      })
      if (errors.length) throw new SpecFailure(`page errors: ${errors.join('; ')}`)
      passed++
      console.log(`  ok    ${label}`)
    } catch (err) {
      failures.push(`${label}: ${err instanceof SpecFailure ? err.message : String(err)}`)
      console.log(`  FAIL  ${label}`)
    } finally {
      await page.close()
    }
  }
}
await browser.close()
server.close()

console.log(`\nrendered: ${passed} passed, ${failures.length} failed (${chosen.length} specs)`)
if (accepted.length) console.log(`accepted ${accepted.length} baselines in ${screens}: review them in the diff before committing`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(failures.length || chosen.length === 0 ? 1 : 0)
