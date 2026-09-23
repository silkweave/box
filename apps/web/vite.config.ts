import { boxJsonPath, brandingPlugin } from './branding.ts'
import { defineConfig, defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { APP_STORAGE_PREFIX } from './src/lib/storagePrefix.ts'
import { readBoxConfig } from '@silkweave/box-core/box-json'

// The Box dashboard SPA (@silkweave/box-web). Nest is the single origin: in dev it reverse-proxies
// non-API routes here to Vite for HMR, so the browser hits ONE port and the client uses relative
// URLs (identical in dev and prod - no CORS, no VITE_API_URL). The reciprocal proxy below keeps the
// bare Vite port working standalone too. `root` is this dir (apps/web). `@/*` -> src;
// plugin-react-swc avoids a Babel/browserslist transform bug.
//
// Both ports use the merged root configuration. Vite's own dotenv loading is disabled.
// The config reader imports only Node builtins and is safe to load before workspace builds.
const root = fileURLToPath(new URL('.', import.meta.url))
const workspace = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const require = createRequire(import.meta.url)
const monacoEditorWorker = require.resolve('monaco-editor/editor/editor.worker.js') as string
const box = readBoxConfig(dirname(boxJsonPath))

// index.html's no-flash script has to resolve the persisted theme BEFORE any module loads, so it
// cannot import the key - it has to spell it out. From 2026-09-14 to 2026-09-15 it spelled out the
// WRONG one (`silkweave.theme` against an `applyTheme()` that had been de-branded to `ui.theme`),
// and every dark-mode user got a light flash on every load that no check in this repo could see.
// Substituting it here is what makes that literal impossible to drift: the placeholder and
// `appKey('theme')` now come off the same constant. `storagePrefix.ts` imports nothing on purpose -
// Node loads this config without the workspace's @silkweave/box-source condition.
const themeKey = {
  name: 'box-theme-key',
  transformIndexHtml: (html: string) => html.replaceAll('__BOX_THEME_KEY__', `${APP_STORAGE_PREFIX}.theme`),
}

const vitePort = box.server.vitePort
const serverPort = box.server.port
const serverUrl = `http://localhost:${serverPort}`

export default defineConfig(({ mode }) => ({
  root,
  envDir: false,
  base: '/',
  plugins: [react(), tailwindcss(), themeKey, brandingPlugin(box.brand)],
  resolve: {
    // Local WorkerDeck packages must share the dashboard's React instance.
    dedupe: ['react', 'react-dom'],
    // Prepend the @silkweave/box-source condition so any future workspace-package import resolves to its TS
    // source in dev (no build step); harmless today since the SPA imports no workspace package.
    conditions: ['@silkweave/box-source', ...defaultClientConditions],
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: 'monaco-editor/editor/editor.worker.js', replacement: monacoEditorWorker },
    ],
  },
  server: {
    port: vitePort,
    // Nest is the canonical origin - don't auto-open the bare Vite port.
    open: false,
    // Nest proxies to us with changeOrigin:false, so the browser's Host arrives intact. Over
    // tailscale that Host is the tailnet name, which Vite's host check rejects by default (a blank
    // page with "Blocked request" in the console, from a server that logged nothing wrong). Allow
    // the tailnet suffix rather than `true`: this binds to loopback anyway, and a dev server that
    // trusts every Host is the DNS-rebinding hole the check is there to close.
    allowedHosts: ['.ts.net', 'localhost'],
    // The dev server is reachable through the Box origin before sign-in, so /@fs/ must never reach
    // instance state. Allow only browser source and the Bun dependency store (where @fontsource
    // ships its font files), never the checkout root or apps/server: box.local.json holds the
    // session and token secrets and data/ holds the databases. The nested Stack box/ checkout is
    // outside the list too. The deny list restates Vite's defaults, which `deny` replaces, and adds
    // Box configuration by name. Do not deny `**/data/**`: dependencies ship data/ folders. Keep
    // the allow list in step with DEV_SOURCE_DIRS in apps/server/src/auth/dev-proxy-guard.ts.
    fs: {
      allow: [workspace('apps/web'), workspace('packages'), workspace('features'), workspace('node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', 'box.json', 'box.local.json'],
    },
    // Reciprocal proxy so hitting the bare Vite port still reaches the backend. Normal flow is
    // Nest -> Vite. tRPC subscriptions are SSE and /mcp is Streamable HTTP - http-proxy streams
    // both (no compression on these paths, so nothing buffers).
    proxy: {
      '/trpc': { target: serverUrl, changeOrigin: true },
      '/mcp': { target: serverUrl, changeOrigin: true },
      // Incidental REST routes the SPA calls directly (e.g. /api/content/asset images).
      '/api': { target: serverUrl, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: mode === 'builder' ? fileURLToPath(new URL('./builder.html', import.meta.url)) : { app: fileURLToPath(new URL('./index.html', import.meta.url)), builder: fileURLToPath(new URL('./builder.html', import.meta.url)) } },
    // This full-featured Box ships a ~2.3 MB dashboard chunk. Keep a 3 MB budget
    // for meaningful growth warnings without splitting modules solely for size.
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: { exclude: ['monaco-editor'] },
}))
