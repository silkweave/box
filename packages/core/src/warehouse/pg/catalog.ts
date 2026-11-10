// The canonical catalog check (PERMISSIONS.md 11.2, 11.9, 11.11): compares the cluster with the
// contract, not with another cluster, and fails closed. Run at boot, after every policy change,
// and before a restored or switched cluster is activated.
//
// The contract: the role inventory and attributes, the whole membership graph and its options,
// no per-role or per-database setting overrides except the database search_path, no login with a
// password (peer authentication only), every view security_invoker, ownership,
// database / schema / relation ACLs, owner default privileges per area, row security on exactly
// the listed tables with the listed policies, functions (no SECURITY DEFINER, only a fixed
// search_path, PUBLIC EXECUTE only on approved extension members), the ext schema and its
// extensions, the set_config ACL, and the authentication files and directory modes.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'
import { hbaContract, identContract, OWNER_LOGIN } from '../../db/cluster.js'
import { CORE_LOGIN, SYSTEM_LOGIN } from '../executor.js'
import { areaGroup, areaSchema, CORE_SCHEMA, EXT_SCHEMA } from './areas.js'
import { ROW_FOREIGN_KEYS, ROW_POLICIES, ROW_SECURITY_LEDGER, rowSecurityTables } from './rls.js'
import { desiredGroups, POLICY_JOURNAL_TABLE, POLICY_LOGIN, POLICY_STATE_PUBLIC_COLUMNS, POLICY_STATE_TABLE, POLICY_USER_COLUMNS, ROLE_LOGINS_TABLE, type RolePolicy } from './policy.js'

/** Approved extensions and the version range admitted (PLAN.md capability profiles). */
export const APPROVED_EXTENSIONS: Record<string, (version: string) => boolean> = {
  vector: (v) => { const [a, b] = v.split('.').map(Number); return a! > 0 || (a === 0 && b! >= 8) },
}


export interface CatalogContract {
  /** Feature areas with schemas. */
  areas: readonly string[]
  /** Core's shared tables (models), granted to box_core and box_system. */
  coreTables: readonly string[]
  /** Every role the Box defines (built-ins included), for the expected login memberships. */
  roles: readonly RolePolicy[]
  /** Feature tables box_policy also writes (`schema.table`, pg/policy.ts policyTablesOf). */
  policyTables?: readonly string[]
}

const W = 'arwd'

function parseAcl(acl: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!acl) return out
  for (const item of acl.replace(/^\{|\}$/g, '').split(',').filter(Boolean)) {
    const [who, rest] = item.replace(/"/g, '').split('=')
    const privs = rest!.split('/')[0]!
    if (who === OWNER_LOGIN || who === 'pg_database_owner') continue
    out[who || 'public'] = privs
  }
  return out
}
const norm = (x: Record<string, string>) => JSON.stringify(Object.entries(x).map(([k, v]) => [k, [...v].sort().join('')]).sort())
const same = (a: Record<string, string>, b: Record<string, string>) => norm(a) === norm(b)

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Problems found on the Box database (empty when it matches the contract). `c` is an owner client on it. */
export async function catalogCheck(c: pg.Client, contract: CatalogContract): Promise<string[]> {
  const problems: string[] = []
  const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await c.query(sql, params)).rows
  const database = (await q('select current_database() d'))[0]!.d as string
  const schemas = new Map(contract.areas.map((a) => [areaSchema(a), a]))
  const appSchemas = [CORE_SCHEMA, EXT_SCHEMA, 'public', ...schemas.keys()]
  const coreTables = new Set(contract.coreTables)
  const rlsTables = new Set(rowSecurityTables(contract.coreTables).map((t) => `${CORE_SCHEMA}.${t}`))
  const policyTables = new Set(contract.policyTables ?? [])
  const policySchemas = new Set([...policyTables].map((t) => t.slice(0, t.indexOf('.'))))

  const { problems: roleProblems, routed } = await checkRolePolicy(q, contract)
  problems.push(...roleProblems)

  // Setting overrides: only the database search_path.
  for (const x of await q(`select coalesce(r.rolname, '') r, coalesce(d.datname, '') d, s.setconfig::text cfg
      from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole left join pg_database d on d.oid = s.setdatabase`)) {
    if (x.r === '' && x.d === database && x.cfg === `{search_path=${EXT_SCHEMA}}`) continue
    problems.push(`setting override for ${x.r || '*'} on ${x.d || '*'}: ${x.cfg}`)
  }

  // Passwords: every login authenticates by peer (hbaContract), so none holds one. A runtime login
  // can set its own (ALTER ROLE current_user PASSWORD); unusable under peer auth, but drift.
  for (const x of await q(`select rolname r from pg_authid where rolpassword is not null order by rolname`)) problems.push(`login ${x.r} has a password`)

  // Ownership: application schemas and everything in them belong to the owner.
  for (const x of await q(`select n.nspname || '.' || c.relname o, r.rolname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner where n.nspname = any($1) and r.rolname <> $2`, [appSchemas, OWNER_LOGIN])) problems.push(`${x.o} owned by ${x.rolname}`)
  for (const x of await q(`select nspname, r.rolname from pg_namespace n join pg_roles r on r.oid = n.nspowner
      where nspname = any($1) and nspname <> 'public' and r.rolname <> $2`, [appSchemas, OWNER_LOGIN])) problems.push(`schema ${x.nspname} owned by ${x.rolname}`)

  // Database ACL.
  const [db] = await q(`select datacl::text a from pg_database where datname = $1`, [database])
  const dbAcl = parseAcl(db?.a ?? null)
  const routedLogins = Object.fromEntries([...routed].map((l) => [l, 'c']))
  if (!same(dbAcl, { [CORE_LOGIN]: 'c', [SYSTEM_LOGIN]: 'c', [POLICY_LOGIN]: 'c*', ...routedLogins })) problems.push(`database ACL ${db?.a}`)

  // Schema ACLs.
  for (const x of await q(`select nspname s, nspacl::text a from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'`)) {
    let want: Record<string, string> | null = null
    if (x.s === CORE_SCHEMA) want = { [CORE_LOGIN]: 'U', [SYSTEM_LOGIN]: 'U', [POLICY_LOGIN]: 'U', public: 'U' }
    else if (x.s === EXT_SCHEMA) want = { public: 'U' }
    else if (x.s === 'public') want = {}
    else if (schemas.has(x.s)) {
      const a = schemas.get(x.s)!
      want = { [areaGroup(a, 'read')]: 'U', [areaGroup(a, 'write')]: 'U', [SYSTEM_LOGIN]: 'U', ...(policySchemas.has(x.s) ? { [POLICY_LOGIN]: 'U' } : {}) }
    }
    if (!want) { problems.push(`unexpected schema ${x.s}`); continue }
    if (!same(parseAcl(x.a), want)) problems.push(`schema ${x.s} ACL ${x.a}`)
  }

  // Relation ACLs and row security.
  for (const x of await q(`select n.nspname s, c.relname t, c.relkind k, c.relacl::text a, c.relrowsecurity rls, c.relforcerowsecurity f,
        coalesce(c.reloptions::text, '') ro
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r','v','S','m','p','f')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')`, [appSchemas])) {
    const name = `${x.s}.${x.t}`
    let want: Record<string, string> | null = null
    if (schemas.has(x.s)) {
      const a = schemas.get(x.s)!
      if (x.k === 'S') want = { [areaGroup(a, 'write')]: 'rU', [SYSTEM_LOGIN]: 'rU' }
      else if (x.k === 'r' || x.k === 'v' || x.k === 'p') want = { [areaGroup(a, 'read')]: 'r', [areaGroup(a, 'write')]: W, [SYSTEM_LOGIN]: W, ...(policyTables.has(name) ? { [POLICY_LOGIN]: W } : {}) }
    } else if (x.s === CORE_SCHEMA) {
      if (x.t === 'schema_migrations' || x.t === 'schema_contract' || x.t === ROW_SECURITY_LEDGER) want = {}
      else if (x.t === ROLE_LOGINS_TABLE) want = { [POLICY_LOGIN]: W, [CORE_LOGIN]: 'r', [SYSTEM_LOGIN]: 'r' }
      else if (x.t === POLICY_STATE_TABLE) want = { [POLICY_LOGIN]: 'rw' }
      else if (x.t === POLICY_JOURNAL_TABLE) want = { [POLICY_LOGIN]: W }
      else if (x.t === 'roles' && coreTables.has(x.t)) want = { [CORE_LOGIN]: 'r', [SYSTEM_LOGIN]: 'r', [POLICY_LOGIN]: W }
      else if (x.t === 'users' && coreTables.has(x.t)) want = { [CORE_LOGIN]: 'rd', [SYSTEM_LOGIN]: 'rd', [POLICY_LOGIN]: 'd' }
      else if (coreTables.has(x.t) && x.k === 'r') want = { [CORE_LOGIN]: W, [SYSTEM_LOGIN]: W }
    }
    if (!want) { problems.push(`unexpected relation ${name} (${x.k})`); continue }
    if (!same(parseAcl(x.a), want)) problems.push(`${name} ACL ${x.a}`)
    if (x.k === 'r' && x.rls !== rlsTables.has(name)) problems.push(`${name} row security ${x.rls ? 'on' : 'off'}`)
    if (x.f) problems.push(`${name} forces row security`)
    // A view runs with its owner's privileges unless security_invoker (PERMISSIONS 11): the owner
    // reaches every table, so a definer view would hand its readers what their login cannot read.
    if (x.k === 'v' && !/\bsecurity_invoker=(true|on|yes|1)\b/i.test(x.ro as string)) problems.push(`view ${name} is not security_invoker`)
  }
  // Column ACLs, on core.users and core.policy_state: box_core and box_system insert and update every column but
  // `role`; box_policy reads and writes only what role assignment needs (a role is a policy row).
  const wantCols = new Map<string, Record<string, string>>()
  if (coreTables.has('users')) {
    const cols = (await q(`select a.attname n from pg_attribute a where a.attrelid = '${CORE_SCHEMA}.users'::regclass and a.attnum > 0 and not a.attisdropped`)).map((r) => r.n as string)
    const at = (col: string) => { const k = `${CORE_SCHEMA}.users.${col}`; if (!wantCols.has(k)) wantCols.set(k, {}); return wantCols.get(k)! }
    for (const col of cols) if (col !== 'role') { at(col)[CORE_LOGIN] = 'aw'; at(col)[SYSTEM_LOGIN] = 'aw' }
    for (const col of POLICY_USER_COLUMNS.select) at(col)[POLICY_LOGIN] = 'r'
    for (const col of POLICY_USER_COLUMNS.update) at(col)[POLICY_LOGIN] = (at(col)[POLICY_LOGIN] ?? '') + 'w'
  }
  // PUBLIC reads the policy revision row's id and revision (admission), nothing else of it.
  for (const col of POLICY_STATE_PUBLIC_COLUMNS) wantCols.set(`${CORE_SCHEMA}.${POLICY_STATE_TABLE}.${col}`, { public: 'r' })
  const seenCols = new Set<string>()
  for (const x of await q(`select n.nspname || '.' || c.relname || '.' || a.attname col, a.attacl::text acl
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and a.attacl is not null and not a.attisdropped`, [appSchemas])) {
    seenCols.add(x.col)
    const want = wantCols.get(x.col)
    if (!want || !same(parseAcl(x.acl), want)) problems.push(`column ${x.col} ACL ${x.acl}`)
  }
  for (const col of wantCols.keys()) if (!seenCols.has(col)) problems.push(`column ${col} ACL missing`)

  // Row policies: exactly the contract's (rls.ts), permissive, per command and role, with the
  // expressions exactly as the server deparses them.
  const pol = await q(`select schemaname || '.' || tablename t, policyname p, permissive, roles::text r, cmd, qual, with_check from pg_policies`)
  const wantPol = new Map(ROW_POLICIES.filter((p) => rlsTables.has(`${CORE_SCHEMA}.${p.table}`)).map((p) => [`${CORE_SCHEMA}.${p.table}.${p.name}`, p]))
  const seenPol = new Set<string>()
  for (const x of pol) {
    const key = `${x.t}.${x.p}`
    const want = wantPol.get(key)
    seenPol.add(key)
    if (!want) { problems.push(`unexpected policy ${key}`); continue }
    const got = `${x.permissive}|${x.r}|${x.cmd}|${x.qual ?? ''}|${x.with_check ?? ''}`
    const expected = `PERMISSIVE|{${want.role}}|${want.command}|${want.using ?? ''}|${want.check ?? ''}`
    if (got !== expected) problems.push(`policy ${key} differs: ${got} (expected ${expected})`)
  }
  for (const key of wantPol.keys()) if (!seenPol.has(key)) problems.push(`policy ${key} missing`)

  // Foreign keys row security relies on (rls.ts ROW_FOREIGN_KEYS): present exactly once with the
  // listed columns, simple match, validated, both actions cascading, every RI trigger enforced
  // (origin mode), and the referenced columns a unique or primary key.
  const cols = (rel: string, nums: string) => `array(select a.attname::text from unnest(${nums}) with ordinality k(n, i) join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.i)`
  for (const fk of ROW_FOREIGN_KEYS.filter((f) => coreTables.has(f.table) && coreTables.has(f.references.table))) {
    const name = `${CORE_SCHEMA}.${fk.table} (${fk.columns.join(', ')}) -> ${fk.references.table} (${fk.references.columns.join(', ')})`
    const found = await q(`select c.oid, c.confupdtype::text upd, c.confdeltype::text del, c.confmatchtype::text m, c.convalidated v,
        (select coalesce(bool_and(t.tgenabled = 'O'), false) from pg_trigger t where t.tgconstraint = c.oid) enforced,
        (select count(*)::int from pg_trigger t where t.tgconstraint = c.oid) triggers
      from pg_constraint c
      where c.contype = 'f' and c.conrelid = $1::regclass and c.confrelid = $2::regclass
        and ${cols('c.conrelid', 'c.conkey')} = $3::text[] and ${cols('c.confrelid', 'c.confkey')} = $4::text[]`,
      [`${CORE_SCHEMA}.${fk.table}`, `${CORE_SCHEMA}.${fk.references.table}`, fk.columns, fk.references.columns])
    if (found.length !== 1) { problems.push(`foreign key ${name} ${found.length ? 'declared twice' : 'missing'}`); continue }
    const f = found[0]!
    if (f.upd !== 'c' || f.del !== 'c') problems.push(`foreign key ${name} does not cascade (on update ${f.upd}, on delete ${f.del})`)
    if (f.m !== 's') problems.push(`foreign key ${name} match type ${f.m}`)
    if (!f.v) problems.push(`foreign key ${name} not validated`)
    if (!f.enforced || f.triggers === 0) problems.push(`foreign key ${name} not enforced (trigger disabled)`)
    const unique = await q(`select 1 from pg_constraint c where c.contype in ('u', 'p') and c.conrelid = $1::regclass and c.convalidated
        and ${cols('c.conrelid', 'c.conkey')} = $2::text[]`, [`${CORE_SCHEMA}.${fk.references.table}`, fk.references.columns])
    if (unique.length === 0) problems.push(`unique key ${CORE_SCHEMA}.${fk.references.table} (${fk.references.columns.join(', ')}) missing`)
  }

  // Default privileges: the owner's, per area schema, and the global revoke of PUBLIC EXECUTE.
  const defs = await q(`select coalesce(n.nspname, '') s, d.defaclobjtype::text t, d.defaclacl::text a, r.rolname owner
      from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace join pg_roles r on r.oid = d.defaclrole`)
  for (const d of defs) {
    if (d.owner !== OWNER_LOGIN) { problems.push(`default privileges of ${d.owner}`); continue }
    if (d.s === '') {
      if (d.t !== 'f' || 'public' in parseAcl(d.a)) problems.push(`global default privileges ${d.t} ${d.a}`)
      continue
    }
    const a = schemas.get(d.s)
    if (!a) { problems.push(`unexpected default privileges in ${d.s}`); continue }
    const want: Record<string, Record<string, string>> = {
      r: { [areaGroup(a, 'read')]: 'r', [areaGroup(a, 'write')]: W, [SYSTEM_LOGIN]: W },
      S: { [areaGroup(a, 'write')]: 'rU', [SYSTEM_LOGIN]: 'rU' },
      f: { [areaGroup(a, 'read')]: 'X', [areaGroup(a, 'write')]: 'X' },
    }
    if (!want[d.t] || !same(parseAcl(d.a), want[d.t]!)) problems.push(`default privileges ${d.s}:${d.t} ${d.a}`)
  }
  for (const a of contract.areas) for (const t of ['r', 'S', 'f']) {
    if (!defs.some((d) => d.s === areaSchema(a) && d.t === t)) problems.push(`default privileges ${areaSchema(a)}:${t} missing`)
  }
  if (!defs.some((d) => d.s === '' && d.t === 'f')) problems.push('PUBLIC EXECUTE is not revoked by default')

  // Functions.
  const fns = await q(`select n.nspname || '.' || p.proname f, n.nspname s, p.prosecdef d, p.proconfig::text cfg, r.rolname owner,
        e.extname ext, has_function_privilege('public', p.oid, 'EXECUTE') pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
      left join pg_depend dep on dep.classid = 'pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e'
      left join pg_extension e on e.oid = dep.refobjid
      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'`)
  for (const f of fns) {
    const approved = !!f.ext && f.ext in APPROVED_EXTENSIONS
    if (f.s === EXT_SCHEMA && !approved) problems.push(`non-extension function ${f.f} in ext`)
    if (f.d) problems.push(`security definer ${f.f}`)
    if (f.cfg && !approved && !/^\{search_path=[a-z_, ]+\}$/.test(f.cfg)) problems.push(`function ${f.f} sets ${f.cfg}`)
    if (f.pub && !approved) problems.push(`PUBLIC can execute ${f.f}`)
    if (f.owner !== OWNER_LOGIN) problems.push(`${f.f} owned by ${f.owner}`)
  }
  for (const x of await q(`select n.nspname || '.' || c.relname o from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_depend dep on dep.classid = 'pg_class'::regclass and dep.objid = c.oid and dep.deptype = 'e'
      where n.nspname = $1 and dep.objid is null`, [EXT_SCHEMA])) problems.push(`non-extension relation ${x.o} in ext`)
  for (const x of await q(`select extname, extversion, n.nspname s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where extname <> 'plpgsql'`)) {
    const ok = APPROVED_EXTENSIONS[x.extname]
    if (!ok || !ok(x.extversion) || x.s !== EXT_SCHEMA) problems.push(`extension ${x.extname} ${x.extversion} in ${x.s} not approved`)
  }
  const [sc] = await q(`select has_function_privilege('public', 'pg_catalog.set_config(text, text, boolean)', 'EXECUTE') x`)
  if (sc?.x) problems.push('PUBLIC can execute set_config')
  return problems
}

/** The filesystem half: authentication files and directory modes (11.1). */
export function fileCheck(dataDir: string, socketDir: string): string[] {
  const problems: string[] = []
  const uid = process.getuid?.()
  if (readFileSync(join(dataDir, 'pg_hba.conf'), 'utf8') !== hbaContract()) problems.push('pg_hba.conf differs from the contract')
  if (readFileSync(join(dataDir, 'pg_ident.conf'), 'utf8') !== identContract()) problems.push('pg_ident.conf differs from the contract')
  for (const [label, d] of [['data', dataDir], ['socket', socketDir]] as const) {
    const st = statSync(d)
    if (st.uid !== uid || (st.mode & 0o077) !== 0) problems.push(`${label} directory ${d} is not private (mode ${(st.mode & 0o777).toString(8)})`)
  }
  return problems
}

export class CatalogMismatch extends Error {
  constructor(readonly problems: string[]) {
    super(`the database does not match its security contract (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n  ${problems.join('\n  ')}`)
  }
}

/**
 * The role part of the contract: inventory and attributes, role logins against the roles and the
 * routing table, the membership graph and its options. Readable by any login (catalogs only), so
 * the policy service runs it on its own connection before committing a change (PERMISSIONS 11.2).
 */
export async function checkRolePolicy(q: (sql: string, params?: unknown[]) => Promise<Row[]>, contract: CatalogContract): Promise<{ problems: string[]; routed: Set<string> }> {
  const problems: string[] = []
  const groups = new Set(contract.areas.flatMap((a) => [areaGroup(a, 'read'), areaGroup(a, 'write')]))
  // Roles and attributes.
  const roles = await q(`select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname !~ '^pg_'`)
  const byName = new Map(roles.map((r) => [r.rolname as string, r]))
  const elevated = (r: Row) => r.rolsuper || r.rolcreatedb || r.rolreplication || r.rolbypassrls
  for (const r of roles) {
    const known = r.rolname === OWNER_LOGIN || [CORE_LOGIN, SYSTEM_LOGIN, POLICY_LOGIN].includes(r.rolname) || groups.has(r.rolname) || /^box_role_[1-9][0-9]*$/.test(r.rolname)
    if (!known) problems.push(`unexpected role ${r.rolname}`)
  }
  for (const g of groups) {
    const r = byName.get(g)
    if (!r) { problems.push(`group ${g} missing`); continue }
    if (r.rolcanlogin || elevated(r) || r.rolcreaterole) problems.push(`group ${g} has login or elevated attributes`)
  }
  for (const l of [CORE_LOGIN, SYSTEM_LOGIN, POLICY_LOGIN]) {
    const r = byName.get(l)
    if (!r) { problems.push(`login ${l} missing`); continue }
    if (!r.rolcanlogin || elevated(r) || r.rolcreaterole !== (l === POLICY_LOGIN)) problems.push(`login ${l} has wrong attributes`)
  }

  // Role logins against the roles and the routing table.
  const loginRows = await q(`select role_id, login, retired_at from ${CORE_SCHEMA}.${ROLE_LOGINS_TABLE}`)
  const routing = new Map(loginRows.filter((x) => x.retired_at === null).map((x) => [x.role_id as string, x.login as string]))
  // Retiring logins (cleanup pending) hold nothing: no membership is expected for them and the
  // database ACL check below admits CONNECT only for routed logins.
  const retiring = new Set(loginRows.filter((x) => x.retired_at !== null).map((x) => x.login as string))
  const expected = new Set<string>()
  for (const role of contract.roles) {
    const login = routing.get(role.id)
    if (!login) { problems.push(`role ${role.id} has no login`); continue }
    for (const g of desiredGroups(role, contract.areas)) expected.add(`${login}>${g}`)
  }
  const roleIds = new Set(contract.roles.map((r) => r.id))
  for (const [roleId, login] of routing) {
    if (!roleIds.has(roleId)) problems.push(`login ${login} routes the unknown role ${roleId}`)
    if (!byName.has(login)) problems.push(`login ${login} missing`)
  }
  const routed = new Set(routing.values())
  for (const r of roles.filter((x) => x.rolname.startsWith('box_role_'))) {
    if (!routed.has(r.rolname) && !retiring.has(r.rolname)) problems.push(`login ${r.rolname} is not in the routing table`)
    if (!r.rolcanlogin || elevated(r) || r.rolcreaterole) problems.push(`${r.rolname} has wrong attributes`)
  }

  // The membership graph.
  const mem = await q(`select m.rolname member, g.rolname grp, am.admin_option a, am.inherit_option i, am.set_option s
      from pg_auth_members am join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.roleid
     -- The server's predefined roles among themselves (pg_monitor's members) are not the Box's.
     where not (m.rolname ~ '^pg_' and g.rolname ~ '^pg_')`)
  const actual = new Set<string>()
  for (const x of mem) {
    const edge = `${x.member}>${x.grp}`
    if (x.member === CORE_LOGIN && x.grp === 'pg_use_reserved_connections' && !x.a && x.i && !x.s) continue
    if (x.member === POLICY_LOGIN && groups.has(x.grp) && x.a && !x.i && !x.s) continue
    // PG 16+: the creator of a role holds ADMIN on it (no inherit, no set).
    if (x.member === POLICY_LOGIN && x.grp.startsWith('box_role_') && x.a && !x.i && !x.s) continue
    if (x.member === OWNER_LOGIN) continue
    if (x.member.startsWith('box_role_') && groups.has(x.grp)) {
      if (x.a || !x.i || x.s) problems.push(`${edge} has wrong options`)
      actual.add(edge)
      continue
    }
    problems.push(`unexpected membership ${edge}`)
  }
  for (const e of expected) if (!actual.has(e)) problems.push(`missing membership ${e}`)
  for (const a of actual) if (!expected.has(a)) problems.push(`unexpected membership ${a}`)

  return { problems, routed }
}
