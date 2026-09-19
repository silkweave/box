// The MCP proxy's import graph must never reach the warehouse.
//
// `pnpm cli <Tool>` and `box <tool-name>` are the fastest commands this repo has, and they are
// fast because `mcp-proxy.ts` imports four published packages and nothing from this workspace.
// Pull in `@silkweave/box-core` - directly, or through a barrel that re-exports it, or by adding a
// workspace dependency to `packages/cli` - and every tool invocation starts loading DuckDB.
//
// This was a PACKAGE boundary until 2026-09-17: the proxy lived in `apps/cli`, whose package.json
// simply did not depend on core, so the property was structural and could not regress. Folding the
// proxy into `packages/cli` next to the repository tooling gave that up in exchange for one
// CLI package, so the boundary has to be asserted instead. A barrel export would regress it
// silently; this test is what makes it loud.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { repoRoot } from '../repo.ts'

/** Everything the proxy is allowed to reach outside this package. Node builtins are always fine. */
const ALLOWED = new Set(['@silkweave/box-core/box-json', '@silkweave/core', '@silkweave/mcp/cli-proxy', 'commander', '@clack/prompts'])

/** Static `from '...'`, bare `import '...'`, `export ... from '...'`, and dynamic `import('...')`. */
const specifiersOf = (source: string): string[] => [
  ...source.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g),
  ...source.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g),
  ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
].map((m) => m[1] as string)

/** Walk relative imports from `entry`, returning every file reached and every bare specifier seen. */
function graph(entry: string): { files: string[]; bare: Set<string> } {
  const files: string[] = []
  const bare = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift() as string
    if (files.includes(file)) continue
    files.push(file)
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:')) continue
      if (!spec.startsWith('.')) {
        bare.add(spec)
        continue
      }
      queue.push(resolve(dirname(file), spec))
    }
  }
  return { files, bare }
}

test('the MCP proxy reaches nothing in this workspace, so no tool call loads the warehouse', () => {
  const { files, bare } = graph(join(repoRoot, 'packages/cli/src/mcp-proxy.ts'))
  const forbidden = [...bare].filter((spec) => !ALLOWED.has(spec))
  assert.deepEqual(
    forbidden,
    [],
    `mcp-proxy.ts must not import ${forbidden.join(', ')}. Anything from this workspace drags DuckDB into every tool call.`,
  )
  // A relative import out of this package would slip past the allowlist entirely.
  const escapes = files.map((f) => relative(repoRoot, f)).filter((p) => !p.startsWith('packages/cli/src/'))
  assert.deepEqual(escapes, [], `mcp-proxy.ts reached ${escapes.join(', ')} through a relative import`)
})

test('the shared configuration subpath imports only Node builtins', () => {
  const source = readFileSync(join(repoRoot, 'packages/core/src/box-json.ts'), 'utf8')
  assert.deepEqual(specifiersOf(source).filter(spec => !spec.startsWith('node:')), [])
})

test('packages/cli declares no workspace dependency, which is what keeps the graph shallow', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages/cli/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }
  const workspace = Object.entries(declared)
    .filter(([name, spec]) => spec.startsWith('workspace:') || name.startsWith('@silkweave/box-'))
    .map(([name]) => name)
  assert.deepEqual(workspace, [], `packages/cli must not depend on ${workspace.join(', ')}`)
})
