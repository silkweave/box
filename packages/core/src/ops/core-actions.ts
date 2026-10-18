// Core's own runnable actions - the ones every Box has regardless of features. Joined with the
// feature manifests' actions in ops/registry.ts.

import { backupWarehouse } from '../warehouse/backup.js'
import { sourceSyncAction, sourcesSyncAction } from '../signals/sources/actions.js'
import { todayUtc, type ActionSpec, type IngestProgress } from './types.js'

async function* warehouseBackupAction(): AsyncGenerator<IngestProgress> {
  yield { channel: 'warehouse', phase: 'start', message: 'backing up the warehouse' }
  const res = await backupWarehouse()
  yield { channel: 'warehouse', phase: 'done', message: res.summary, result: { channel: 'warehouse', date: todayUtc(), summary: res.summary } }
}

export const CORE_ACTIONS: readonly ActionSpec[] = [
  { id: 'warehouse-backup', label: 'Warehouse backup', group: 'Warehouse', description: 'Copy the warehouse to <instance>/backups (and to GCS when backup.gcsBucket is set)', run: warehouseBackupAction },
  { id: 'sources-sync', label: 'Data sources sync', group: 'Pulls', description: 'Pull every ENABLED data source (Settings → Data sources) into the signals bound to it; one bad source does not stop the others', run: sourcesSyncAction },
  {
    id: 'source-sync',
    label: 'Sync one data source',
    group: 'Pulls',
    description: 'Pull ONE data source, disabled ones included - the supervised first run before a source is armed (params: source_id)',
    parameterized: true,
    run: (opts) => sourceSyncAction({ source_id: opts.params?.source_id ?? '' }),
  },
]
