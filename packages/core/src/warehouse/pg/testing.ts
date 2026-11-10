// The database test harness (PHASE1.md choice 11, W4).
//
//   startTemplateCluster   once per test run (Vitest globalSetup): a private cluster, the migrated
//                          template database `box_template` with every registered owner's schema,
//                          role logins for the built-in roles
//   useTestDatabase        once per test file: a clone of the template (all template connections
//                          are closed first), its database ACL re-applied, the process executor
//                          pointed at it; dropped after the file
//
// Databases isolate tables, not cluster-wide roles and memberships: a test that creates logins,
// groups or memberships, or checks the catalog, starts its own cluster (db/testing.ts).

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { OWNER_LOGIN } from '../../db/cluster.js'
import { startTestCluster, type TestCluster } from '../../db/testing.js'
import type { DatabaseEngine } from '../../box-json.js'
import { closeExecutor, configureExecutor, setKnownAreas, type Executor } from '../executor.js'
import { bootDatabase, clearPolicyService, installTestPolicyService, withClient, type BootOptions, type Target } from './boot.js'
import { ensureDatabase, ensureDatabaseAcl, readRoleLogins } from './policy.js'

export const TEMPLATE_DATABASE = 'box_template'

declare module 'vitest' {
  /** The run's template (vitest.db-setup.ts): `useTestDatabase(inject('boxDb'))`. */
  export interface ProvidedContext { boxDb: TemplateInfo }
}

export interface TemplateInfo {
  engine: DatabaseEngine
  socket: string
  port: number
  database: string
  knownAreas: string[]
}

export async function startTemplateCluster(engine: DatabaseEngine, boot: Omit<BootOptions, 'database' | 'checkFiles'>): Promise<{ info: TemplateInfo; cluster: TestCluster }> {
  const cluster = await startTestCluster(engine)
  const t: Target = { socket: cluster.running.socket, port: cluster.running.port }
  try {
    await bootDatabase(t, { ...boot, database: TEMPLATE_DATABASE, checkFiles: false })
    // CREATE DATABASE ... TEMPLATE needs the template without connections.
    clearPolicyService()
    await closeExecutor()
  } catch (e) { await cluster.stop(); throw e }
  return { info: { engine, ...t, database: TEMPLATE_DATABASE, knownAreas: [...boot.knownAreas] }, cluster }
}

export interface TestDatabase {
  database: string
  executor: Executor
  /** Owner (maintenance) SQL on the clone: fixtures, assertions on the catalog. */
  owner<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  drop(): Promise<void>
}

/** A fresh clone of the template for one test file, with the process executor pointed at it. */
export async function useTestDatabase(info: TemplateInfo): Promise<TestDatabase> {
  const t: Target = { socket: info.socket, port: info.port }
  const database = `t_${process.pid}_${randomBytes(4).toString('hex')}`
  await withClient(t, OWNER_LOGIN, 'postgres', (c) => ensureDatabase(c, database, info.database))
  await withClient(t, OWNER_LOGIN, database, async (c) => {
    await ensureDatabaseAcl(c, (await readRoleLogins(c)).values())
  })
  setKnownAreas(info.knownAreas)
  const executor = configureExecutor({ host: t.socket, port: t.port, database })
  // Policy commands and admission on the clone, without a login reconcile (shared cluster logins).
  await installTestPolicyService(t, database)
  return {
    database,
    executor,
    owner: (sql, params) => withClient(t, OWNER_LOGIN, database, async (c) => (await c.query(sql, params)).rows),
    async drop() {
      clearPolicyService()
      await closeExecutor()
      await withClient(t, OWNER_LOGIN, 'postgres', (c) => c.query(`drop database if exists ${database} with (force)`))
    },
  }
}
