// The dev proxy's file-serving boundary, pinned. On 2026-09-23 an anonymous
// `/@fs/<checkout>/box.local.json` through the Box origin returned the session secret; Vite's own
// allow-list is the first fix, this guard is the second, and these are the encodings and
// symlink shapes it has to hold against whatever Vite decodes next.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { classifyDevProxyRequest, createDevProxyGuard, devSourceScope, resolveRealPath, type DevSourceScope } from './dev-proxy-guard.js'

const REPO = '/Users/dev/stack'
const SCOPE: DevSourceScope = {
  roots: ['apps/web', 'packages', 'features', 'recipes', 'node_modules'].map((dir) => `${REPO}/${dir}`),
  deny: [`${REPO}/node_modules/.cache`],
}

// A filesystem stand-in: Bun's workspace links (node_modules/@silkweave/* -> packages/*), two
// hostile links that a dependency could plant, and nothing under /nowhere.
const LINKS: Record<string, string> = {
  [`${REPO}/node_modules/@silkweave/box-core`]: `${REPO}/packages/core`,
  [`${REPO}/node_modules/evil-root`]: REPO,
  [`${REPO}/node_modules/evil-home`]: '/Users/dev',
}
const resolve = (path: string): string | null => {
  if (path.startsWith('/nowhere')) return null
  for (const [link, target] of Object.entries(LINKS)) {
    if (path === link || path.startsWith(`${link}/`)) return target + path.slice(link.length)
  }
  return path
}

const verdict = (url: string) => classifyDevProxyRequest(url, SCOPE, resolve)

describe('classifyDevProxyRequest: what the anonymous login page needs is forwarded', () => {
  it.each([
    '/',
    '/index.html',
    '/login',
    '/login/abc123?next=%2Fsignals',
    '/@vite/client',
    '/@react-refresh',
    '/@id/__x00__virtual:box-brand',
    '/src/main.tsx',
    '/src/views/LoginView.tsx?t=1758600000000',
    '/node_modules/.vite/deps/react.js?v=6c6cdece',
    '/node_modules/.vite/deps/chunk-ABC.js?v=939d6caa',
    '/brand-logo.svg',
    '/manifest.webmanifest',
    `/@fs${REPO}/packages/ui/src/index.ts`,
    `/@fs${REPO}/packages/core/src/builder-browser.ts`,
    `/@fs${REPO}/features/data/web/index.tsx`,
    `/@fs${REPO}/recipes/crm/RECIPE.md?raw`,
    `/@fs${REPO}/recipes/crm/screenshots/board.png`,
    `/@fs${REPO}/apps/web/src/lib/utils.ts?import`,
    `/@fs${REPO}/apps/web/src/App.tsx?raw`,
    `/@fs${REPO}/node_modules/.bun/vite@8.3.0+5e27b56279d105f0/node_modules/vite/dist/client/env.mjs`,
    `/@fs${REPO}/node_modules/.bun/@fontsource+inter@5.3.0/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2`,
    `/@fs${REPO}/node_modules/.vite/deps/react.js.map`,
    `/@fs${REPO}/node_modules/@silkweave/box-core/src/index.ts`,
    `/@fs${REPO}/node_modules/.cacheX/y.js`,
    `/@fs${REPO}/packages/ui/src/My%20Component.tsx`,
  ])('%s', (url) => {
    expect(verdict(url)).toBe('forward')
  })
})

describe('classifyDevProxyRequest: instance state is refused on every spelling', () => {
  it.each([
    `/@fs${REPO}/box.local.json`,
    `/@fs${REPO}/box.json`,
    `/@fs${REPO}/data/data.db`,
    `/@fs${REPO}/README.md`,
    `/@fs${REPO}/box/box.local.json`,
    `/@fs${REPO}/.stack/features/crm/core/index.ts`,
    `/@fs${REPO}/.stack/recipes/crm/RECIPE.md?raw`,
    `/@fs${REPO}/box/.stack/box.local.json`,
    `/@fs${REPO}/_docs/INTEGRATION.md`,
    `/@fs${REPO}/apps/server/src/main.ts`,
    `/@fs${REPO}/apps/server/src/main.ts?raw`,
    `/@fs${REPO}/node_modules/.cache/backup-test-X/data.db`,
    `/@fs${REPO}/node_modules/.cache/backup-test-X/box.json?raw`,
    `/@fs${REPO}/node_modules/.cache`,
    `/@fs${REPO}/box.local.json?raw`,
    `/@fs${REPO}/box.local.json?import&raw`,
    `/@fs${REPO}/box.local.json?url`,
    `/@fs${REPO}/box.local.json?inline`,
    `/@fs${REPO}/box.local.json?raw??`,
    `/@fs${REPO}/data/data.db?import`,
    '/@fs/etc/passwd',
    '/@fs/Users/dev/.ssh/id_ed25519',
  ])('%s', (url) => {
    expect(verdict(url)).toBe('refuse')
  })
})

describe('classifyDevProxyRequest: traversal and encoding tricks', () => {
  it.each([
    [`/@fs${REPO}/apps/web/../../box.local.json`, 'plain dot-dot'],
    [`/@fs${REPO}/apps/web/..%2f..%2fbox.local.json`, 'encoded slash'],
    [`/@fs${REPO}/apps/web/%2e%2e/%2e%2e/box.local.json`, 'encoded dots'],
    [`/@fs${REPO}/apps/web/%2E%2E/%2E%2E/box.local.json`, 'encoded dots, upper case'],
    [`/@fs${REPO}/apps/web/%252e%252e/%252e%252e/box.local.json`, 'double encoded dots leave a residual %'],
    [`/@fs${REPO}/node_modules%2f..%2fbox.local.json`, 'encoded slash after an allowed dir'],
    [`/@fs${REPO}/node_modules/../box.local.json`, 'dot-dot straight out of an allowed dir'],
    [`/@fs${REPO}/node_modules/#/../../box.local.json`, 'fragment (CVE-2025-32395 shape)'],
    [`/@fs${REPO}/node_modules/%23/../../box.local.json`, 'encoded fragment'],
    [`/@fs${REPO}/apps/web/..\\..\\box.local.json`, 'backslashes'],
    [`/@fs${REPO}/apps/web/..%5c..%5cbox.local.json`, 'encoded backslashes'],
    [`/@fs/${REPO}/box.local.json`, 'double slash after the prefix'],
    [`/@fs${REPO}/apps/./web/../../box.local.json`, 'single dot segments'],
    [`/@fs${REPO}/apps//web/../../box.local.json`, 'empty segment'],
    [`/@fs${REPO}/node_modules/`, 'trailing slash'],
    [`/@fs${REPO}/node_modules/%00/../../box.local.json`, 'NUL'],
    [`/@fs${REPO}/node_modules/%0a/../../box.local.json`, 'newline'],
    [`/@fs${REPO}/node_modules/%zz`, 'malformed percent sequence'],
    ['/@fs/C:/Users/dev/stack/box.local.json', 'drive letter'],
    [`/@fs${REPO}/node_modules/file:x`, 'colon'],
    [`/@fs${REPO}/node_modules/evil-root/box.local.json`, 'symlink to the checkout root'],
    [`/@fs${REPO}/node_modules/evil-home/.ssh/id_ed25519`, 'symlink out of the checkout'],
    [`/@fs${REPO}/node_modules/@silkweave/box-core/../../box.local.json`, 'dot-dot through a workspace link'],
    ['/@fs/nowhere/at/all.ts', 'nothing on the path exists'],
    [`/@fs${REPO}/node_modulesX/x.ts`, 'sibling with an allowed prefix'],
    [`/@fs${REPO}/apps/webX/x.ts`, 'sibling of apps/web'],
    [`/@fs${REPO}/Node_Modules/x.ts`, 'case is not folded before the realpath'],
    [`http://box.local/@fs${REPO}/node_modules/x.ts`, 'absolute-form request target'],
    ['/src/../../../box.local.json', 'root-relative traversal'],
    ['/..%2f..%2fbox.local.json', 'root-relative encoded traversal'],
    ['/%2e%2e/box.local.json', 'root-relative encoded dots'],
    ['/node_modules/../../../box.local.json?raw&import', 'root-relative traversal with raw import'],
    ['/@id/../../box.local.json?import', 'traversal in a virtual id'],
    ['/src/main.tsx#/../../box.local.json', 'fragment on a root-relative path'],
    ['/src/%00main.tsx', 'NUL on a root-relative path'],
  ])('%s (%s)', (url) => {
    expect(verdict(url)).toBe('refuse')
  })
})

describe('classifyDevProxyRequest: the editor hook wants a session', () => {
  it.each(['/__open-in-editor', `/__open-in-editor?file=${encodeURIComponent(`${REPO}/apps/web/src/App.tsx:1:1`)}`, '/__open-in-editor/'])('%s', (url) => {
    expect(verdict(url)).toBe('session')
  })
  it('does not match a longer name', () => {
    expect(verdict('/__open-in-editor-help')).toBe('forward')
  })
})

describe('resolveRealPath and devSourceScope against a real filesystem', () => {
  const base = mkdtempSync(join(tmpdir(), 'dev-proxy-guard-'))
  mkdirSync(join(base, 'packages', 'nested'), { recursive: true })
  mkdirSync(join(base, 'node_modules', '.cache', 'fixture'), { recursive: true })
  mkdirSync(join(base, 'secret'))
  writeFileSync(join(base, 'packages', 'nested', 'file.ts'), 'export {}\n')
  writeFileSync(join(base, 'node_modules', 'dep.js'), 'export {}\n')
  writeFileSync(join(base, 'node_modules', '.cache', 'fixture', 'data.db'), '')
  writeFileSync(join(base, 'secret', 'box.local.json'), '{}\n')
  symlinkSync(join('..', 'secret'), join(base, 'packages', 'link'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  // tmpdir is itself behind a symlink on macOS (/var -> /private/var); the scope must be realpaths.
  const real = resolveRealPath(base)!
  const scope = devSourceScope(base)

  it('keeps only the directories that exist, as realpaths', () => {
    expect(scope).toEqual({ roots: [join(real, 'packages'), join(real, 'node_modules')], deny: [join(real, 'node_modules', '.cache')] })
  })
  it('follows the requested path to the file that would be read', () => {
    expect(classifyDevProxyRequest(`/@fs${base}/packages/nested/file.ts`, scope)).toBe('forward')
    expect(classifyDevProxyRequest(`/@fs${real}/packages/nested/file.ts`, scope)).toBe('forward')
    expect(classifyDevProxyRequest(`/@fs${base}/packages/nested/missing.ts.map`, scope)).toBe('forward')
    expect(classifyDevProxyRequest(`/@fs${base}/packages/missing/dir/x.ts`, scope)).toBe('forward')
    expect(classifyDevProxyRequest(`/@fs${base}/node_modules/dep.js`, scope)).toBe('forward')
  })
  it('refuses a symlink that leaves the allowed directory, the target itself, and the denied cache', () => {
    expect(classifyDevProxyRequest(`/@fs${base}/packages/link/box.local.json`, scope)).toBe('refuse')
    expect(classifyDevProxyRequest(`/@fs${base}/packages/link/missing.json`, scope)).toBe('refuse')
    expect(classifyDevProxyRequest(`/@fs${base}/secret/box.local.json`, scope)).toBe('refuse')
    expect(classifyDevProxyRequest(`/@fs${base}/node_modules/.cache/fixture/data.db`, scope)).toBe('refuse')
    expect(classifyDevProxyRequest(`/@fs${base}/node_modules/.cache/missing.db`, scope)).toBe('refuse')
  })
  it('resolves a missing tail under an existing ancestor and nothing for garbage', () => {
    expect(resolveRealPath(join(base, 'packages', 'nested', 'missing.ts'))).toBe(join(real, 'packages', 'nested', 'missing.ts'))
    expect(resolveRealPath(join(base, 'packages', 'link', 'missing.json'))).toBe(join(real, 'secret', 'missing.json'))
    expect(resolveRealPath('/')).toBe('/')
  })
})

describe('createDevProxyGuard', () => {
  function run(url: string, authenticate: (req: IncomingMessage) => Promise<boolean>) {
    const onRefuse = vi.fn()
    const forward = vi.fn()
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
    const req = { url } as IncomingMessage
    createDevProxyGuard({ scope: SCOPE, authenticate, onRefuse, resolve })(req, res as unknown as ServerResponse, forward)
    return { onRefuse, forward, res }
  }
  const settle = () => new Promise((done) => setTimeout(done, 0))

  it('forwards source without consulting the session', async () => {
    const authenticate = vi.fn(async () => false)
    const { forward, res } = run('/src/main.tsx', authenticate)
    await settle()
    expect(forward).toHaveBeenCalledOnce()
    expect(authenticate).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })
  it('answers 403 itself for instance state, whoever asks', async () => {
    const authenticate = vi.fn(async () => true)
    const { forward, res, onRefuse } = run(`/@fs${REPO}/box.local.json`, authenticate)
    await settle()
    expect(forward).not.toHaveBeenCalled()
    expect(authenticate).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.end).toHaveBeenCalledOnce()
    expect(onRefuse).toHaveBeenCalledWith(expect.objectContaining({ url: `/@fs${REPO}/box.local.json` }), 'refuse')
  })
  it('forwards the editor hook with a session and refuses it without', async () => {
    const withSession = run('/__open-in-editor?file=x', async () => true)
    const without = run('/__open-in-editor?file=x', async () => false)
    await settle()
    expect(withSession.forward).toHaveBeenCalledOnce()
    expect(without.forward).not.toHaveBeenCalled()
    expect(without.res.statusCode).toBe(403)
    expect(without.onRefuse).toHaveBeenCalledWith(expect.anything(), 'session')
  })
  it('refuses when the session check throws rather than falling open', async () => {
    const { forward, res } = run('/__open-in-editor?file=x', async () => { throw new Error('warehouse down') })
    await settle()
    expect(forward).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })
})
