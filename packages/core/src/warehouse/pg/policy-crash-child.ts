// A separate Box process for policy-crash.test.ts (matrix A5): boots the policy service on the
// test's cluster like a server does, then stops at a chosen point of a policy command and waits to
// be killed. Not a test file and not a build entry.
//
//   bun --conditions=@silkweave/box-source policy-crash-child.ts <instance dir> <socket> <port> <mode>
//
// Modes: `boot` (boot and exit 0), `before-commit` (a role row written inside the policy
// transaction, never committed), `create-after-commit` / `retire-after-commit` (the command has
// committed and is about to publish and clean up). Prints READY when it is at the point.

import { BUILTIN_ROLES, deleteRole, knownAreas, upsertRole } from '../../auth/roles.js'
import { setInstanceDir } from '../../testing.js'
import { boxSchemaOwners } from '../schema.js'
import { bootDatabase, policyCommand, setPolicyTestHooks } from './boot.js'

const [dir, socket, port, mode] = process.argv.slice(2)
setInstanceDir(dir!)
const forever = () => new Promise<never>(() => {})
const ready = () => process.stdout.write('READY\n')

const { core, features } = boxSchemaOwners()
await bootDatabase({ socket: socket!, port: Number(port) }, {
  core, features, checkFiles: false, knownAreas: knownAreas(),
  builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })),
})

if (mode === 'boot') process.exit(0)
if (mode === 'before-commit') {
  await policyCommand('test: crash before commit', async (tx) => {
    await tx.run(`insert into core.roles (id, label, default_level, areas, created_at, updated_at) values ('crash-pre', 'Crash pre', 'none', '{"support":"write"}'::jsonb, now(), now())`)
    ready()
    await forever()
  })
}
setPolicyTestHooks({ beforeCommandPublish: async () => { ready(); await forever() } })
if (mode === 'create-after-commit') await upsertRole({ id: 'crash-post', label: 'Crash post', default: 'none', areas: { support: 'write' } })
if (mode === 'retire-after-commit') await deleteRole('crash-gone')
throw new Error(`unknown mode ${mode}`)
