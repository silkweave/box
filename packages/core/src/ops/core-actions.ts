// Core's own runnable actions - the ones every Box has regardless of features. Joined with the
// feature manifests' actions in ops/registry.ts.

import { backupWarehouse } from '../warehouse/backup.js'
import { todayUtc, type ActionSpec, type IngestProgress } from './types.js'

async function* warehouseBackupAction(): AsyncGenerator<IngestProgress> {
  yield { channel: 'warehouse', phase: 'start', message: 'backing up the warehouse' }
  const res = await backupWarehouse()
  yield { channel: 'warehouse', phase: 'done', message: res.summary, result: { channel: 'warehouse', date: todayUtc(), summary: res.summary } }
}

export const CORE_ACTIONS: readonly ActionSpec[] = [
  { id: 'warehouse-backup', label: 'Warehouse backup', group: 'Warehouse', description: 'Copy the warehouse to <instance>/backups (and to GCS when GCS_BUCKET is set)', run: warehouseBackupAction },
]
