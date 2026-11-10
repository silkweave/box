// Typed queries on the tables the auth layer reads and writes on the executor path (reach `core`,
// the bootstrap or the caller's frame). The policy service's maintenance-client statements stay on
// `pg` (warehouse/pg/boot.ts PolicyTx) and do not use this.
//
// `core.policy_state` is not a model (the policy DDL creates it), so its type is written here; the
// name carries its schema because the area map does not know it.
import type { CoreDb } from '../warehouse/core-models.js'
import { coreDb } from '../warehouse/kysely.js'

interface PolicyStateTable {
  id: number
  revision: number
}

export interface AuthDb {
  users: CoreDb['users']
  'core.policy_state': PolicyStateTable
}

export const db = coreDb<AuthDb>()
