// The warehouse API (PHASE1.md choice 5): PostgreSQL through the executor (pg/store.ts).
//
//   withRead(sql, params, { reach })  one statement in a read-only transaction
//   withReadOnly(fn, { reach })       several reads in one read-only transaction (read committed)
//   withSnapshot(fn, { reach })       several reads that see one snapshot (repeatable read)
//   withWrite(fn, { reach })          a real transaction; fn(tx) with tx.query / tx.run
//   withSerializable(fn)              serializable read-modify-write with a bounded retry
//
// The schema is brought up once per process by bootDatabase (pg/boot.ts) before any of this runs.

import { withWrite } from './pg/store.js'
import { db } from './core-db.js'
import { json, now } from './kysely.js'

export { withRead, withReadOnly, withSerializable, withSnapshot, withWrite, type ReadOptions as WarehouseReadOptions, type Tx } from './pg/store.js'
export { afterCommit, inTransaction } from './executor.js'

/** Read one kv_state value, or null when the key has never been written. */
export async function getKvState<T>(key: string): Promise<T | null> {
  const row = await db.selectFrom('kv_state').select('value').where('key', '=', key).executeTakeFirst()
  return (row?.value ?? null) as T | null
}

/** UPSERT one kv_state value. */
export async function setKvState(key: string, value: unknown): Promise<void> {
  await withWrite(async () => {
    await db.insertInto('kv_state')
      .values({ key, value: json(value), updated_at: now() })
      .onConflict((oc) => oc.column('key').doUpdateSet((eb) => ({ value: eb.ref('excluded.value'), updated_at: eb.ref('excluded.updated_at') })))
      .execute()
  }, { reach: 'core' })
}
