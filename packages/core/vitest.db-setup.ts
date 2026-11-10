// One database cluster per test run (PHASE1.md choice 11): the migrated template every test file
// clones with `useTestDatabase(inject('boxDb'))`. The engine is the run's: pgrust by default,
// `native` for the second engine suite (BOX_TEST_ENGINE: a Stack-maintainer switch read by this
// test runner only, never a Box setting).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import type { DatabaseEngine } from './src/box-json.js'
import { BUILTIN_ROLES, knownAreas } from './src/auth/roles.js'
import { FEATURE_LIST } from './src/generated/features.js'
import { boxSchemaOwners } from './src/warehouse/schema.js'
import { startTemplateCluster } from './src/warehouse/pg/testing.js'

// Test-only roles, each reaching one area (test-support: support write; test-artifacts-reader and -writer: artifacts at one level; test-bell: chat, crm and ops read, the bell's areas; test-chat-reader and -writer: chat at one level; test-crm-reader: crm read), so cross-area paths can run as a member who lacks the
// neighbouring area (PERMISSIONS 5.5). A feature's own test roles live beside it in
// `features/<id>/test-roles.json` (`[{ "id", "areas" }]`, default none). They exist in the test cluster only, with their own logins.
type TestRole = { id: string; default: 'none'; areas: Record<string, 'read' | 'write'> }
const CORE_TEST_ROLES: TestRole[] = [
  { id: 'test-support', default: 'none', areas: { support: 'write' } },
  { id: 'test-artifacts-reader', default: 'none', areas: { artifacts: 'read' } },
  { id: 'test-artifacts-writer', default: 'none', areas: { artifacts: 'write' } },
  { id: 'test-bell', default: 'none', areas: { chat: 'read', crm: 'read', ops: 'read' } },
  { id: 'test-chat-reader', default: 'none', areas: { chat: 'read' } },
  { id: 'test-chat-writer', default: 'none', areas: { chat: 'write' } },
  { id: 'test-crm-reader', default: 'none', areas: { crm: 'read' } },
]

function featureTestRoles(): TestRole[] {
  const root = fileURLToPath(new URL('../../features', import.meta.url))
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = `${root}/${entry.name}/test-roles.json`
    if (!entry.isDirectory() || !existsSync(file)) return []
    return (JSON.parse(readFileSync(file, 'utf8')) as { id: string; areas: TestRole['areas'] }[]).map((r) => ({ ...r, default: 'none' as const }))
  })
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const engine = (process.env.BOX_TEST_ENGINE ?? 'pgrust') as DatabaseEngine
  if (engine !== 'pgrust' && engine !== 'native') throw new Error(`BOX_TEST_ENGINE must be pgrust or native, not "${engine}"`)
  const { info, cluster } = await startTemplateCluster(engine, {
    ...boxSchemaOwners(FEATURE_LIST),
    builtinRoles: [...BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })), ...CORE_TEST_ROLES, ...featureTestRoles()],
    knownAreas: knownAreas(),
  })
  project.provide('boxDb', info)
  return () => cluster.stop()
}
