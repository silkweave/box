// The warehouse's restore points, from the host shell. Two kinds live side by side:
//
//   seeds/<name>.db      named dev fixtures. Yours. Nothing ever prunes them.
//   backups/<label>-...  machine-generated safety net (manual, pre-migrate, pre-restore),
//                        kept generationally by core (packages/core/src/warehouse/restore-points.ts).
//
// Every copy here is taken under the warehouse write lock after a CHECKPOINT, so a running server
// cannot interleave a write into the copy. Connections are ephemeral (packages/core warehouse/db.ts),
// so a running `pnpm dev` reads a restored file on its next query - but restart it if the restore
// point's schema is older than the running code, because ensureSchema() is memoized per process.
//
//   pnpm db:snapshot [name]   copy data.db -> seeds/<name>.db (default name: baseline)
//   pnpm db:backup            copy data.db -> backups/manual-<stamp>.db (+ GCS when configured)
//   pnpm db:seeds             list every restore point with its time and size
//   pnpm db:restore [name]    restore a seed or a backup over data.db (previous state is parked)

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  backupWarehouse,
  instanceRelative,
  listRestorePoints,
  restoreWarehouse,
  seedsDir,
  warehousePath,
  withWrite,
} from '@silkweave/box-core'

const NAME = /^[a-z0-9][a-z0-9-]*$/

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

async function main(): Promise<void> {
  const [cmd, nameArg] = process.argv.slice(2)
  const db = warehousePath()

  if (cmd === 'list') {
    const points = listRestorePoints()
    if (points.length === 0) {
      console.log('no restore points yet - create one with: pnpm db:backup (or pnpm db:snapshot [name])')
      return
    }
    for (const p of points) {
      const when = p.takenAt.toISOString().slice(0, 16).replace('T', ' ')
      console.log(`${p.name.padEnd(40)} ${p.label.padEnd(12)} ${mb(p.bytes).padStart(7)} MB  ${when}`)
    }
    console.log(`\nrestore one with: pnpm db:restore <name>`)
    return
  }

  if (cmd === 'backup') {
    const result = await backupWarehouse({ label: 'manual' })
    console.log(result.summary)
    return
  }

  if (cmd === 'restore') {
    const name = nameArg ?? 'baseline'
    const result = await restoreWarehouse(name)
    console.log(result.summary)
    return
  }

  if (cmd === 'snapshot') {
    const name = nameArg ?? 'baseline'
    if (!NAME.test(name)) {
      console.error(`invalid snapshot name "${name}" (use a-z, 0-9, -)`)
      process.exit(1)
    }
    if (!existsSync(db)) {
      console.error(`no warehouse at ${db} - nothing to snapshot`)
      process.exit(1)
    }
    const dir = seedsDir()
    mkdirSync(dir, { recursive: true })
    const seed = join(dir, `${name}.db`)
    // Copy inside the held write connection, for the same reason core's backups do: the moment
    // withWrite returns, the next chained write (or another process) may open the file.
    await withWrite(async (conn) => {
      await conn.run('CHECKPOINT')
      rmSync(`${seed}.wal`, { force: true })
      copyFileSync(db, seed)
      if (existsSync(`${db}.wal`)) copyFileSync(`${db}.wal`, `${seed}.wal`)
    })
    console.log(`seed '${name}' saved to ${instanceRelative(seed)} (${mb(statSync(seed).size)} MB) - restore with: pnpm db:restore ${name}`)
    return
  }

  console.error('usage: pnpm db:snapshot [name] | pnpm db:backup | pnpm db:seeds | pnpm db:restore [name]')
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(String((err as Error)?.message ?? err))
    process.exit(1)
  })
