// The brand, from `box.json`, into the SPA - at BUILD time, in three places:
//
//   1. `index.html`'s `__BOX_BRAND_*__` placeholders (title, icons, theme colour), substituted.
//   2. `manifest.webmanifest`, generated (served by the dev server, emitted into the build).
//   3. The `virtual:box-brand` module, which is how the React tree gets the values: the browser
//      bundle cannot read a file, and fetching the brand at runtime would paint the login page
//      unbranded first. `App.tsx` imports it like any module; `src/vite-env.d.ts` types it.
//
// A brand edit therefore needs a rebuild (or a dev-server restart) to reach the browser; the server
// reads the same block at call time (packages/core/src/brand.ts).
//
// This file is loaded by Node from vite.config.ts WITHOUT the workspace's @silkweave/box-source
// condition, so it may import only Node builtins, `vite` types, and the dependency-free
// packages/core/src/box-json.ts (which is why that module imports nothing else).
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { readBoxConfig, type BoxBrand } from '@silkweave/box-core/box-json'

/** `<checkout>/box.json`, resolved from this file: the vite config cannot ask core where it is. */
export const boxJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'box.json')

/** The brand block, or the defaults on a checkout that has no `data/` yet. */
export const readBrand = (): BoxBrand => readBoxConfig(dirname(boxJsonPath)).brand

const VIRTUAL_ID = 'virtual:box-brand'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)

export function brandingPlugin(brand: BoxBrand = readBrand()): Plugin {
  const manifest = JSON.stringify({
    name: brand.name, short_name: brand.shortName, description: brand.description,
    start_url: '/', display: 'standalone', background_color: brand.backgroundColor,
    theme_color: brand.themeColor,
    icons: [
      { src: brand.icon192, sizes: '192x192', type: 'image/png' },
      { src: brand.icon512, sizes: '512x512', type: 'image/png' },
    ],
  }, null, 2)
  return {
    name: 'box-branding',
    configResolved(config) {
      for (const asset of [brand.logoUrl, brand.icon192, brand.icon512, brand.appleTouchIcon]) {
        if (!/^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(asset) || asset.split('/').includes('..')) {
          throw new Error(`Brand artwork must be an origin-relative public asset: ${asset}`)
        }
        if (!existsSync(resolve(config.publicDir, asset.slice(1)))) throw new Error(`Missing brand artwork: ${asset}`)
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(brand)}\n` : undefined
    },
    transformIndexHtml(html) {
      const values: Record<string, string> = {
        NAME: brand.name, SHORT_NAME: brand.shortName, ICON: brand.icon512,
        APPLE_ICON: brand.appleTouchIcon, THEME_COLOR: brand.themeColor,
      }
      return html.replace(/__BOX_BRAND_(\w+)__/g, (_, key: string) => {
        if (!(key in values)) throw new Error(`Unknown brand placeholder: ${key}`)
        return escapeHtml(values[key]!)
      })
    },
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(manifest)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest })
    },
  }
}
