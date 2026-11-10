// Preloaded by policy-crash.test.ts into its child Bun process (no Vite there): the child sees the
// same registry as the tests, the installed features plus the fixtures of feature-fixtures.testing.ts.
import { fileURLToPath } from 'node:url'

const fixtures = fileURLToPath(new URL('../../feature-fixtures.testing.ts', import.meta.url))

interface ResolveArgs { importer: string }
declare const Bun: { plugin(spec: { name: string; setup(build: { onResolve(options: { filter: RegExp }, callback: (args: ResolveArgs) => { path: string } | undefined): void }): void }): void }

Bun.plugin({
  name: 'box-feature-fixtures',
  setup(build) {
    build.onResolve({ filter: /generated\/features\.js$/ }, (args) => (args.importer === fixtures ? undefined : { path: fixtures }))
  },
})
