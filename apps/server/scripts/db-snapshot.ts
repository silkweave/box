// The Box database's restore points and clusters, from the host shell. Restore points are
// directories (box.dump, agents.json, manifest.json) of two kinds:
//
//   seeds/<name>/          named dev fixtures. Yours. Nothing ever prunes them.
//   backups/db/<label>-... machine-generated safety net (manual, pre-migrate, pre-restore,
//                          pre-switch), kept generationally (packages/core/src/warehouse/restore-points.ts).
//
// A backup and a snapshot run online (the running Box keeps serving). Restore, switch and prune
// are offline maintenance: stop Box first (they refuse while it runs).
//
//   box db backup              a restore point under backups/db/ (+ the bucket when configured)
//   box db snapshot [name]     a seed under seeds/<name>/ (default name: baseline)
//   box db list                every restore point with its time and size
//   box db restore <name>      restore a seed or a backup into a fresh cluster (previous parked)
//   box db switch --engine <pgrust|native>   move the database to the other engine
//   box db clusters            the cluster directories and which is active or retired
//   box db prune               delete stopped clusters other than the active one

import {
  backupWarehouse,
  instanceRelative,
  listDatabaseClusters,
  listRestorePoints,
  pruneDatabaseClusters,
  restoreWarehouse,
  snapshotSeed,
  switchDatabaseEngine,
} from '@silkweave/box-core'
import { commandError, commandHeader, commandLine, commandSuccess } from '../../../packages/cli/src/command-ui.js'

const USAGE = 'Usage: box db backup | snapshot [name] | list | restore <name> | switch --engine <pgrust|native> | clusters | prune'

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const [cmd, nameArg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--engine')

  if (cmd === 'list') {
    commandHeader('db list')
    const points = listRestorePoints()
    if (points.length === 0) {
      commandLine('No restore points yet.', 'muted')
      commandLine('Create one: box db backup or box db snapshot [name]', 'accent')
      return
    }
    for (const p of points) {
      const when = p.takenAt.toISOString().slice(0, 16).replace('T', ' ')
      commandLine(`${p.name.padEnd(48)} ${p.label.padEnd(12)} ${mb(p.bytes).padStart(7)} MB  ${when}${p.damaged ? `  DAMAGED: ${p.damaged}` : ''}`)
    }
    commandLine('')
    commandLine('Restore one (Box stopped): box db restore <name>', 'muted')
    return
  }

  if (cmd === 'backup') {
    const result = await backupWarehouse({ label: 'manual' })
    commandHeader('db backup')
    commandSuccess(result.summary)
    return
  }

  if (cmd === 'snapshot') {
    const point = await snapshotSeed(nameArg ?? 'baseline')
    commandHeader('db snapshot')
    commandSuccess(`Saved "${point.name}" to ${instanceRelative(point.path)} · ${mb(point.bytes)} MB`)
    commandLine(`Restore it (Box stopped): box db restore ${point.name}`, 'muted')
    return
  }

  if (cmd === 'restore') {
    if (!nameArg) { commandError('Name the restore point: box db restore <name> (box db list shows them)'); process.exit(1) }
    const result = await restoreWarehouse(nameArg)
    commandHeader('db restore')
    commandSuccess(result.summary)
    commandLine('Start Box again to serve the restored database; boot reconciles the agents from the restored files.', 'muted')
    return
  }

  if (cmd === 'switch') {
    const engine = argv[argv.indexOf('--engine') + 1]
    if (!argv.includes('--engine') || (engine !== 'pgrust' && engine !== 'native')) { commandError(USAGE); process.exit(1) }
    const result = await switchDatabaseEngine(engine)
    commandHeader('db switch')
    commandSuccess(result.summary)
    return
  }

  if (cmd === 'clusters') {
    commandHeader('db clusters')
    for (const c of listDatabaseClusters()) commandLine(`${c.name.padEnd(12)} ${c.state.padEnd(8)} ${c.build}`)
    return
  }

  if (cmd === 'prune') {
    const removed = await pruneDatabaseClusters()
    commandHeader('db prune')
    commandSuccess(removed.length ? `Deleted ${removed.join(', ')}` : 'Nothing to delete: only the active cluster is on disk.')
    return
  }

  commandError(USAGE)
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    commandError(String((err as Error)?.message ?? err))
    process.exit(1)
  })
