import { dirname } from 'node:path'
import type { MigrationConn } from './schema.js'
import { copyWarehouseUnderLock, pruneBackupsQuietly } from './restore-points.js'

/**
 * A `pre-migrate` backup under `<instance>/backups/`, taken while the caller HOLDS the warehouse
 * write connection across the CHECKPOINT and the copy. A failure here throws, and applySchema
 * runs it before any pending migration writes, so a snapshot failure blocks the migration.
 * Retention runs only after the copy succeeded and never throws: a full disk is a disk problem,
 * a blocked migration would be a data problem.
 */
export async function snapshotBeforeMigration(conn: MigrationConn, source: string): Promise<string> {
  let path: string
  try {
    path = (await copyWarehouseUnderLock(conn, source, 'pre-migrate')).path
  } catch (error) {
    throw new Error(`pre-migration snapshot failed; schema was not changed: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
  pruneBackupsQuietly(dirname(source))
  return path
}
