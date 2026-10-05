// The `recipes` ledger from `box.json` into the SPA as the `virtual:box-recipes` module: which
// recipes this Box has adapted and which of their powerups it has added. The Recipe Gallery and the
// onboarding dashboard read it beside the build-time recipe catalog (src/lib/recipes.ts).
//
// Like the brand it is read at build time, so a built Box shows the ledger as of its last build.
// That matches the catalog and the feature registry: adapting a recipe or adding a powerup ends with
// the validation chain, which rebuilds. In dev the module is invalidated and the page reloaded when
// box.json or box.local.json changes, so a freshly recorded entry shows without a restart.
//
// Loaded by Node from vite.config.ts without the @silkweave/box-source condition: import only Node
// builtins, `vite` types and the dependency-free box-json module (see branding.ts).
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'
import { readBoxConfig, type BoxRecipe } from '@silkweave/box-core/box-json'

const VIRTUAL_ID = 'virtual:box-recipes'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

export function recipeLedgerPlugin(boxJsonPath: string): Plugin {
  const root = dirname(boxJsonPath)
  const files = [boxJsonPath, join(root, 'box.local.json')]
  const read = (): Record<string, BoxRecipe> => readBoxConfig(root).recipes
  return {
    name: 'box-recipe-ledger',
    resolveId: id => id === VIRTUAL_ID ? RESOLVED_ID : undefined,
    load: id => id === RESOLVED_ID ? `export default ${JSON.stringify(read())}\n` : undefined,
    configureServer(server) {
      server.watcher.add(files)
      server.watcher.on('change', path => {
        if (!files.includes(path)) return
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (!module) return
        server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
