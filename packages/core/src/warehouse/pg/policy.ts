// The database contract's objects (PERMISSIONS.md 11.1 to 11.3) and the policy service that keeps
// role logins in step with the roles.
//
// Maintenance path (owner login, under the schema lock in migrate.ts):
//   ensureClusterObjects   runtime logins box_core, box_system, box_policy; two NOLOGIN groups per
//                          area; box_policy holds ADMIN on the groups (no inherit, no set)
//   ensureDatabase         the Box database, owned by box_owner
//   ensureDatabaseObjects  hardened PUBLIC, the core and ext schemas (pgvector in ext), one schema
//                          per area with owner default privileges granting its tables to its groups
//   grantCoreTables        exact grants on core's shared tables (no area group reaches them)
//
// Runtime path (box_policy, fixed validated commands only):
//   reconcileRoleLogins    one login per role (`box_role_<n>`), its memberships exactly the role's
//                          area levels; a removed role's login stops routing at commit and is dropped
//
// Logins and group names are internal and validated (areas.ts), never user input.

import pg from 'pg'
import { OWNER_LOGIN } from '../../db/cluster.js'
import { CORE_LOGIN, SYSTEM_LOGIN } from '../executor.js'
import { areaGroup, areaSchema, CORE_SCHEMA, EXT_SCHEMA, ident, quoteIdent } from './areas.js'

export const BOX_DATABASE = 'box'
export const POLICY_LOGIN = 'box_policy'
export const ROLE_LOGINS_TABLE = 'role_logins'
export const POLICY_STATE_TABLE = 'policy_state'
/** The policy journal (PERMISSIONS 9.2): file-backed policy changes, applied and recovered from it. */
export const POLICY_JOURNAL_TABLE = 'policy_journal'
/** box_policy's column grants on core.users: a user's role is a policy row, nothing else there is. */
// Role assignment and activation, and the final step of a revoke (status, token revocation, link
// watermark) or a delete: the identity changes that decide whether a principal can act (11.10).
export const POLICY_USER_COLUMNS = { select: ['id', 'kind', 'role', 'status'], update: ['role', 'status', 'token_revoked_at', 'link_watermark', 'updated_at', 'updated_by'] } as const
/** What PUBLIC reads of core.policy_state (admission's probe). */
export const POLICY_STATE_PUBLIC_COLUMNS = ['id', 'revision'] as const
const RUNTIME_ATTRS = 'nosuperuser nocreatedb nocreaterole noreplication nobypassrls'

type Queryable = Pick<pg.Client, 'query'>

const exists = async (c: Queryable, sql: string, params: unknown[]) => (await c.query(sql, params)).rowCount! > 0
const roleExists = (c: Queryable, name: string) => exists(c, 'select 1 from pg_roles where rolname = $1', [name])

/** Cluster-level objects; run on any database of the cluster as the owner. Idempotent. */
export async function ensureClusterObjects(c: Queryable, areas: readonly string[]): Promise<void> {
  for (const login of [CORE_LOGIN, SYSTEM_LOGIN]) {
    if (!(await roleExists(c, login))) await c.query(`create role ${ident(login)} login ${RUNTIME_ATTRS}`)
  }
  if (!(await roleExists(c, POLICY_LOGIN))) {
    await c.query(`create role ${POLICY_LOGIN} login createrole nosuperuser nocreatedb noreplication nobypassrls`)
  }
  await c.query(`grant pg_use_reserved_connections to ${CORE_LOGIN} with inherit true, set false`)
  for (const area of areas) {
    for (const level of ['read', 'write'] as const) {
      const g = areaGroup(area, level)
      if (!(await roleExists(c, g))) await c.query(`create role ${g} nologin ${RUNTIME_ATTRS}`)
      await c.query(`grant ${g} to ${POLICY_LOGIN} with admin true, inherit false, set false`)
    }
  }
}

/** Create a database when missing (run on `postgres`); `template` clones a migrated one (tests). */
export async function ensureDatabase(c: Queryable, name = BOX_DATABASE, template = 'template0'): Promise<boolean> {
  if (await exists(c, 'select 1 from pg_database where datname = $1', [name])) return false
  await c.query(`create database ${ident(name)} owner ${OWNER_LOGIN} encoding 'UTF8' template ${ident(template)}`)
  return true
}

async function currentDatabase(c: Queryable): Promise<string> {
  return ident((await c.query<{ d: string }>('select current_database() d')).rows[0]!.d)
}

/**
 * Database-level settings and ACL: PUBLIC loses everything, the runtime logins (and the given role
 * logins) connect, vector types resolve through ext. Not copied by CREATE DATABASE ... TEMPLATE, so
 * a cloned database runs this again.
 */
export async function ensureDatabaseAcl(c: Queryable, roleLogins: Iterable<string> = []): Promise<void> {
  const db = await currentDatabase(c)
  await c.query(`revoke all on database ${db} from public`)
  await c.query(`grant connect on database ${db} to ${CORE_LOGIN}, ${SYSTEM_LOGIN}`)
  await c.query(`grant connect on database ${db} to ${POLICY_LOGIN} with grant option`)
  for (const login of roleLogins) await c.query(`grant connect on database ${db} to ${ident(login)}`)
  await c.query(`alter database ${db} set search_path = ${EXT_SCHEMA}`)
}

/** Database-level hardening, the core and ext schemas, and the area schemas (run on the Box database). */
export async function ensureDatabaseObjects(c: Queryable, areas: readonly string[]): Promise<void> {
  // PUBLIC loses everything first, before any function or table exists (11.1).
  await ensureDatabaseAcl(c)
  await c.query(`revoke all on schema public from public`)
  await c.query(`alter default privileges for role ${OWNER_LOGIN} revoke execute on functions from public`)
  await c.query(`revoke execute on function pg_catalog.set_config(text, text, boolean) from public`)

  await c.query(`create schema if not exists ${CORE_SCHEMA}`)
  await c.query(`grant usage on schema ${CORE_SCHEMA} to ${CORE_LOGIN}, ${SYSTEM_LOGIN}, ${POLICY_LOGIN}`)

  // Extensions live in the owner-managed `ext` schema; PUBLIC executes only extension members.
  await c.query(`create schema if not exists ${EXT_SCHEMA}`)
  await c.query(`grant usage on schema ${EXT_SCHEMA} to public`)
  await c.query(`create extension if not exists vector schema ${EXT_SCHEMA}`)
  const members = await c.query<{ sig: string }>(
    `select p.oid::regprocedure::text sig from pg_proc p
       join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       join pg_extension e on e.oid = d.refobjid
      where e.extname = 'vector'`,
  )
  for (const { sig } of members.rows) await c.query(`grant execute on function ${sig} to public`)

  // The policy service's own table: which login a role routes to.
  // role_id is null on a retired row (kept until cleanup drops the login; the id may be reused).
  await c.query(`create table if not exists ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} (
    login text primary key check (login ~ '^box_role_[1-9][0-9]*$'),
    role_id text unique,
    retired_at timestamptz,
    check ((role_id is null) = (retired_at is not null))
  )`)
  await c.query(`grant select, insert, update, delete on ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} to ${POLICY_LOGIN}`)
  await c.query(`grant select on ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} to ${CORE_LOGIN}, ${SYSTEM_LOGIN}`)

  // The policy revision (PERMISSIONS 9.2): one row, moved in the transaction of every policy
  // change. Seeded with the epoch milliseconds so a value seen before this database existed (an
  // older Box, a restore) never reads as current.
  await c.query(`create table if not exists ${CORE_SCHEMA}.${POLICY_STATE_TABLE} (
    id smallint primary key check (id = 1),
    revision bigint not null,
    next_login bigint not null check (next_login > 0)
  )`)
  await c.query(`insert into ${CORE_SCHEMA}.${POLICY_STATE_TABLE} (id, revision, next_login) values (1, (extract(epoch from clock_timestamp()) * 1000)::bigint, 1) on conflict (id) do nothing`)
  await c.query(`grant select, update on ${CORE_SCHEMA}.${POLICY_STATE_TABLE} to ${POLICY_LOGIN}`)
  // Every runtime login reads the revision at admission (executor.ts): one row, no data. PUBLIC
  // gets USAGE on core for it and SELECT on two columns of this table only (the singleton id and
  // the revision; `next_login` stays the policy service's); no other core table has a PUBLIC grant.
  await c.query(`revoke select on ${CORE_SCHEMA}.${POLICY_STATE_TABLE} from public`)
  await c.query(`grant select (${POLICY_STATE_PUBLIC_COLUMNS.join(', ')}) on ${CORE_SCHEMA}.${POLICY_STATE_TABLE} to public`)
  await c.query(`grant usage on schema ${CORE_SCHEMA} to public`)

  // The policy journal: a policy change that also writes files (agent config, toolsets) records
  // its plan here before it touches them, so a crash between the database and the files is
  // resumed or rolled back at boot (auth/policy-service.ts). The policy service's alone.
  await c.query(`create table if not exists ${CORE_SCHEMA}.${POLICY_JOURNAL_TABLE} (
    id text primary key,
    reason text not null,
    plan jsonb not null,
    stage text not null check (stage in ('prepared', 'done', 'rolled-back', 'abandoned')),
    detail text,
    created_at timestamptz not null default now(),
    finished_at timestamptz
  )`)
  await c.query(`grant select, insert, update, delete on ${CORE_SCHEMA}.${POLICY_JOURNAL_TABLE} to ${POLICY_LOGIN}`)

  for (const area of areas) {
    const s = areaSchema(area), r = areaGroup(area, 'read'), w = areaGroup(area, 'write')
    await c.query(`create schema if not exists ${quoteIdent(s)}`)
    await c.query(`grant usage on schema ${quoteIdent(s)} to ${r}, ${w}, ${SYSTEM_LOGIN}`)
    const dp = `alter default privileges for role ${OWNER_LOGIN} in schema ${quoteIdent(s)}`
    await c.query(`${dp} grant select on tables to ${r}`)
    await c.query(`${dp} grant select, insert, update, delete on tables to ${w}, ${SYSTEM_LOGIN}`)
    await c.query(`${dp} grant usage, select on sequences to ${w}, ${SYSTEM_LOGIN}`)
    await c.query(`${dp} grant execute on functions to ${r}, ${w}`)
  }
}

/** Feature tables the policy service writes (ModelSpec `policyTable`), as `schema.table`. */
export function policyTablesOf(features: readonly { id: string; models: readonly { table: string; policyTable?: true }[] }[]): string[] {
  return features.flatMap((f) => f.models.filter((m) => m.policyTable).map((m) => `${areaSchema(f.id)}.${m.table}`)).sort()
}

/** box_policy's grants on the policy tables: usage on their schemas, every row privilege on them. */
export async function grantPolicyTables(c: Queryable, tables: readonly string[]): Promise<void> {
  for (const schema of new Set(tables.map((t) => t.slice(0, t.indexOf('.'))))) await c.query(`grant usage on schema ${quoteIdent(schema)} to ${POLICY_LOGIN}`)
  for (const t of tables) {
    const [schema, table] = t.split('.') as [string, string]
    await c.query(`grant select, insert, update, delete on ${quoteIdent(schema)}.${quoteIdent(table)} to ${POLICY_LOGIN}`)
  }
}

/** Exact grants on core's shared tables: box_core (accessors) and box_system read and write them. */
export async function grantCoreTables(c: Queryable, tables: readonly string[], userColumns: readonly string[] = []): Promise<void> {
  const runtime = `${CORE_LOGIN}, ${SYSTEM_LOGIN}`
  for (const t of tables) {
    // Policy rows are the policy service's alone (11.3): the roles table and a user's role.
    if (t === 'roles') {
      await c.query(`revoke all on ${CORE_SCHEMA}.roles from ${runtime}`)
      await c.query(`grant select on ${CORE_SCHEMA}.roles to ${runtime}`)
      await c.query(`grant select, insert, update, delete on ${CORE_SCHEMA}.roles to ${POLICY_LOGIN}`)
      continue
    }
    if (t === 'users' && userColumns.length) {
      const cols = userWritableColumns(userColumns).map(quoteIdent).join(', ')
      await c.query(`revoke all on ${CORE_SCHEMA}.users from ${runtime}`)
      await c.query(`grant select, delete on ${CORE_SCHEMA}.users to ${runtime}`)
      await c.query(`grant insert (${cols}), update (${cols}) on ${CORE_SCHEMA}.users to ${runtime}`)
      await c.query(`revoke all on ${CORE_SCHEMA}.users from ${POLICY_LOGIN}`)
      await c.query(`grant delete on ${CORE_SCHEMA}.users to ${POLICY_LOGIN}`)
      await c.query(`grant select (${POLICY_USER_COLUMNS.select.join(', ')}), update (${POLICY_USER_COLUMNS.update.join(', ')}) on ${CORE_SCHEMA}.users to ${POLICY_LOGIN}`)
      continue
    }
    await c.query(`grant select, insert, update, delete on ${CORE_SCHEMA}.${quoteIdent(t)} to ${runtime}`)
  }
}

/** Every users column box_core and box_system may insert and update: all but `role`. */
export function userWritableColumns(all: readonly string[]): string[] {
  if (!all.includes('role')) throw new Error('users columns must be given (and include role)')
  return all.filter((col) => col !== 'role')
}

// ---- Role logins ----

export interface RolePolicy {
  id: string
  /** The level of every area `areas` does not name. */
  default: 'none' | 'read' | 'write'
  areas: Readonly<Record<string, 'none' | 'read' | 'write'>>
}

/** The groups a role's login belongs to: one per area it reaches (write includes read). */
export function desiredGroups(role: RolePolicy, schemaAreas: readonly string[]): string[] {
  const out: string[] = []
  for (const area of schemaAreas) {
    const level = role.areas[area] ?? role.default
    if (level === 'read' || level === 'write') out.push(areaGroup(area, level))
  }
  return out.sort()
}

export function loginName(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid role login number ${n}`)
  return `box_role_${n}`
}

export interface ReconcileResult {
  /** Role id -> login, as committed. */
  logins: Map<string, string>
  created: string[]
  retired: string[]
  changed: number
}

/**
 * Bring logins and memberships to exactly what `roles` say, in one transaction on box_policy.
 * A new login is unroutable until this commits; a retired login's row goes in the same commit, so
 * it stops routing first, then the login is dropped (its pooled sessions are the executor's to end).
 */
export async function reconcileRoleLogins(policy: pg.Client, roles: readonly RolePolicy[], schemaAreas: readonly string[]): Promise<ReconcileResult> {
  await policy.query('begin')
  try {
    await lockPolicy(policy)
    const result = await reconcileInTransaction(policy, roles, schemaAreas)
    await policy.query('commit')
    // Cleanup (dropRetiredLogins) is the caller's, after it has ended its sessions of `retired`.
    return result
  } catch (e) {
    await policy.query('rollback').catch(() => {})
    throw e
  }
}

/** One policy writer at a time, across processes: the revision row, locked for the transaction. */
export async function lockPolicy(policy: Queryable): Promise<number> {
  const rows = (await policy.query<{ revision: string }>(`select revision from ${CORE_SCHEMA}.${POLICY_STATE_TABLE} where id = 1 for update`)).rows
  if (!rows.length) throw new Error('core.policy_state has no row')
  return Number(rows[0]!.revision)
}

/** Move the revision inside the policy transaction and tell other processes at commit. */
export async function bumpRevisionInTransaction(policy: Queryable): Promise<number> {
  const rows = (await policy.query<{ revision: string }>(
    `update ${CORE_SCHEMA}.${POLICY_STATE_TABLE} set revision = greatest(revision + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint) where id = 1 returning revision`,
  )).rows
  const revision = Number(rows[0]!.revision)
  await policy.query(`select pg_notify('${POLICY_CHANNEL}', $1)`, [String(revision)])
  return revision
}

/** The NOTIFY channel a committed policy change announces itself on (core only, never features). */
export const POLICY_CHANNEL = 'box_policy'

/** Logins retired by a committed reconcile: connect revoked, then dropped (after their sessions ended). */
export async function dropRetiredLogins(policy: Queryable, retired: readonly string[]): Promise<void> {
  for (const login of retired) {
    // Recheck: only a login the table says is retired is dropped, then its row goes.
    const row = (await policy.query(`select 1 from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} where login = $1 and retired_at is not null`, [login])).rows
    if (!row.length) continue
    await policy.query(`drop role if exists ${ident(login)}`)
    await policy.query(`delete from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} where login = $1 and retired_at is not null`, [login])
  }
}

/** Retired logins whose cleanup has not finished (boot and the listener finish them). */
export async function pendingRetiredLogins(c: Queryable): Promise<string[]> {
  return (await c.query<{ login: string }>(`select login from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} where retired_at is not null order by login`)).rows.map((r) => r.login)
}

async function membershipsOf(policy: Queryable, login: string): Promise<{ grp: string; i: boolean; s: boolean; a: boolean }[]> {
  return (await policy.query<{ grp: string; i: boolean; s: boolean; a: boolean }>(
    `select g.rolname grp, am.inherit_option i, am.set_option s, am.admin_option a
       from pg_auth_members am join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.roleid
      where m.rolname = $1`, [login])).rows
}

async function nextLoginNumber(policy: Queryable): Promise<number> {
  const rows = (await policy.query<{ n: string }>(`update ${CORE_SCHEMA}.${POLICY_STATE_TABLE} set next_login = next_login + 1 where id = 1 returning next_login - 1 n`)).rows
  return Number(rows[0]!.n)
}

/** The reconcile itself, inside a transaction the caller opened and holds the policy lock in. */
export async function reconcileInTransaction(policy: Queryable, roles: readonly RolePolicy[], schemaAreas: readonly string[]): Promise<ReconcileResult> {
  const created: string[] = [], retired: string[] = []
  let changed = 0
  const db = await currentDatabase(policy)
  {
    const rows = (await policy.query<{ role_id: string; login: string }>(`select role_id, login from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} where retired_at is null`)).rows
    const logins = new Map(rows.map((r) => [r.role_id, r.login]))
    const wanted = new Set(roles.map((r) => r.id))

    // Retire inside the transaction, before routing disappears: every membership and CONNECT go
    // now, so a login left behind by a failed cleanup holds nothing. The row stays (retired_at)
    // until cleanup has ended its sessions and dropped it.
    for (const [roleId, login] of logins) {
      if (wanted.has(roleId)) continue
      for (const m of await membershipsOf(policy, login)) await policy.query(`revoke ${ident(m.grp)} from ${ident(login)}`)
      await policy.query(`revoke connect on database ${db} from ${ident(login)}`)
      await policy.query(`update ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} set retired_at = now(), role_id = null where login = $1`, [login])
      logins.delete(roleId)
      retired.push(login)
    }
    for (const role of roles) {
      let login = logins.get(role.id)
      if (!login) {
        // Login numbers are never reused: a delayed cleanup or a stale session of a retired login
        // can never meet a new login of the same name.
        login = loginName(await nextLoginNumber(policy))
        if (await roleExists(policy, login)) throw new Error(`login ${login} already exists; refusing to adopt it`)
        await policy.query(`create role ${ident(login)} login ${RUNTIME_ATTRS}`)
        await policy.query(`grant connect on database ${db} to ${ident(login)}`)
        await policy.query(`insert into ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} (role_id, login) values ($1, $2)`, [role.id, login])
        logins.set(role.id, login)
        created.push(login)
      }
      const want = new Set(desiredGroups(role, schemaAreas))
      const have = await membershipsOf(policy, login)
      for (const h of have) {
        if (!want.has(h.grp) || !h.i || h.s || h.a) { await policy.query(`revoke ${ident(h.grp)} from ${ident(login)}`); changed++ }
      }
      const kept = new Set(have.filter((h) => want.has(h.grp) && h.i && !h.s && !h.a).map((h) => h.grp))
      for (const g of want) {
        if (!kept.has(g)) { await policy.query(`grant ${ident(g)} to ${ident(login)} with inherit true, set false`); changed++ }
      }
    }
    return { logins, created, retired, changed: changed + created.length + retired.length }
  }
}

/** The committed routing table (role id -> login), for executor.setRoleLogins. */
export async function readRoleLogins(c: Queryable): Promise<Map<string, string>> {
  const rows = (await c.query<{ role_id: string; login: string }>(`select role_id, login from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE} where retired_at is null`)).rows
  return new Map(rows.map((r) => [r.role_id, r.login]))
}
