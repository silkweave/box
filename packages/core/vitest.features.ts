// A Vite plugin for the test runners: every import of core's installed-feature registry
// (src/generated/features.ts) resolves to feature-fixtures.testing.ts, which adds a fixture for each
// public feature id the Box has not installed. Core and server tests then need no recipe in the
// Box; with the recipes installed (the Stack) the registry is unchanged.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const registry = realpathSync(fileURLToPath(new URL('./src/generated/features.ts', import.meta.url)))
const fixtures = realpathSync(fileURLToPath(new URL('./src/feature-fixtures.testing.ts', import.meta.url)))

const real = (path: string): string => { const file = path.split('?')[0]!.replace(/^file:\/\//, '').replace(/^\/@fs\//, '/'); try { return realpathSync(file) } catch { return file } }

export function featureFixtures(): Plugin {
  return {
    name: 'box-feature-fixtures',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.endsWith('.html') || real(importer) === fixtures || !/generated\/features(\.js|\.ts)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && real(resolved.id) === registry ? fixtures : null
    },
  }
}
