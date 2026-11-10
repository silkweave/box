// The Box database for a running process (PHASE1.md W5): open the active cluster under the
// ownership rules (db/index.ts), bring the schema, role logins and catalog check to service
// (pg/boot.ts), and point the process executor at it. The server and CLI scripts call
// `startDatabase('cli')` (they adopt a supervisor-owned cluster, or own one for their lifetime);
// the supervisor only opens and keeps the cluster (`openDatabase('supervisor')`).

import { BUILTIN_ROLES, knownAreas } from '../auth/roles.js'
import { closeExecutor } from '../warehouse/executor.js'
import { bootDatabase, clearPolicyService, clusterFiles, type BootedDatabase } from '../warehouse/pg/boot.js'
import { boxSchemaOwners } from '../warehouse/schema.js'
import type { OwnerRole, RunningCluster } from './cluster.js'
import { openDatabase } from './index.js'
import { mkdirSync } from 'node:fs'
import { readIdentity } from './cluster.js'
import { takeRestorePoint } from './restore-point.js'
import { backupName, backupsDir } from '../warehouse/restore-points.js'

export interface BoxDatabase {
  running: RunningCluster
  booted: BootedDatabase
  /** Close the executor and let go of the cluster (stopping it when this process owns it). */
  close(): Promise<void>
}

let current: BoxDatabase | null = null

/** Open and boot the Box database for this process; once per process. */
export async function startDatabase(role: Exclude<OwnerRole, 'supervisor'>): Promise<BoxDatabase> {
  if (current) return current
  const { running } = await openDatabase(role)
  try {
    const { core, features } = boxSchemaOwners()
    const booted = await bootDatabase(
      { socket: running.socket, port: running.port },
      {
        core,
        features,
        builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })),
        knownAreas: knownAreas(),
        checkFiles: clusterFiles(running),
        // R5: an existing database gets a pre-migrate restore point before any change; the
        // migrator holds the schema lock, so the dump runs with `schemaLock: 'held'`.
        beforeMigrate: async (pending) => {
          const name = backupName('pre-migrate')
          mkdirSync(backupsDir(), { recursive: true, mode: 0o700 })
          await takeRestorePoint({ target: running, parent: backupsDir(), name, label: 'pre-migrate', schemaLock: 'held',
            source: { cluster: running.cluster.name, identity: readIdentity(running.cluster) } })
          console.info(`[database] ${pending.length} pending change(s); restore point ${name} taken first`)
        },
      },
    )
    const db: BoxDatabase = {
      running,
      booted,
      async close() {
        if (current === db) current = null
        clearPolicyService()
        await closeExecutor()
        await running.release()
      },
    }
    current = db
    return db
  } catch (e) {
    await running.release().catch(() => {})
    throw e
  }
}

/** Run `fn` with the database up, closing it afterwards (CLI scripts). */
export async function withDatabase<T>(fn: () => Promise<T>): Promise<T> {
  const db = await startDatabase('cli')
  try {
    return await fn()
  } finally {
    await db.close()
  }
}
