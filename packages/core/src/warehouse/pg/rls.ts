// Row security on core's shared tables (PERMISSIONS 8.1 to 8.3, storage phase 1 W8 R2). The owning
// area is stored on the row (`area`, `events.areas`; signal_points copies its signal's, held equal
// by a cascading foreign key), and the
// executor puts the frame's reachable areas into `box.read_areas` / `box.write_areas` (CSV; an
// admin's lists carry the pseudo-area `admin`). box_core's policies compare the two, command by
// command; box_system has its own explicit policies (system scopes are reviewed entry points).
//
// RLS backs the accessors' own checks; it does not isolate hostile SQL on box_core, which could
// forge the settings (WAREHOUSE.md). A missing or empty setting denies: `string_to_array` of null
// is null and of '' is an empty array.
//
// This list is the contract: `applyRowSecurity` creates exactly these policies and the catalog
// check compares the cluster's with it (catalog.ts), so an extra permissive policy fails boot.

import { CORE_LOGIN, SYSTEM_LOGIN } from '../executor.js'
import { CORE_SCHEMA, quoteIdent } from './areas.js'

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> }

export type PolicyCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export interface RowPolicy {
  table: string
  name: string
  command: PolicyCommand
  role: string
  /** USING; null for INSERT. */
  using: string | null
  /** WITH CHECK; null for SELECT and DELETE. */
  check: string | null
}

// Written exactly as the server deparses them (pg_policies), so the catalog check compares text
// for text on both engines: no normalizing step that could make two different expressions equal.
const areaList = (setting: 'read' | 'write') => `string_to_array(current_setting('box.${setting}_areas'::text, true), ','::text)`
const READ = areaList('read')
const WRITE = areaList('write')

/** The four box_core policies of a table whose rows satisfy `pred(list)` for the reachable areas. */
function corePolicies(table: string, pred: (list: string) => string, commands: readonly PolicyCommand[]): RowPolicy[] {
  const out: RowPolicy[] = []
  const add = (command: PolicyCommand, using: string | null, check: string | null) =>
    out.push({ table, name: `core_${command.toLowerCase()}`, command, role: CORE_LOGIN, using, check })
  if (commands.includes('SELECT')) add('SELECT', pred(READ), null)
  if (commands.includes('INSERT')) add('INSERT', null, pred(WRITE))
  // An update needs write on the old row (USING) and on the new one (CHECK): rebinding out of or
  // into an unreachable area is refused here too.
  if (commands.includes('UPDATE')) add('UPDATE', pred(WRITE), pred(WRITE))
  if (commands.includes('DELETE')) add('DELETE', pred(WRITE), null)
  return out
}

/** box_system's explicit policies, one per command it uses. */
function systemPolicies(table: string, commands: readonly PolicyCommand[]): RowPolicy[] {
  return commands.map((command) => ({
    table,
    name: `system_${command.toLowerCase()}`,
    command,
    role: SYSTEM_LOGIN,
    using: command === 'INSERT' ? null : 'true',
    check: command === 'INSERT' || command === 'UPDATE' ? 'true' : null,
  }))
}

const ALL: readonly PolicyCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const ownArea = (list: string) => `(area = ANY (${list}))`
// Every area an event names must be reachable; the table's check keeps the list non-empty.
const everyArea = (list: string) => `(areas <@ ${list})`

/** Every row policy, by table. Events are append-only for box_core (no UPDATE or DELETE policy). */
export const ROW_POLICIES: readonly RowPolicy[] = [
  ...corePolicies('signals', ownArea, ALL),
  ...systemPolicies('signals', ALL),
  ...corePolicies('signal_points', ownArea, ALL),
  ...systemPolicies('signal_points', ALL),
  ...corePolicies('snapshots', ownArea, ALL),
  ...systemPolicies('snapshots', ALL),
  ...corePolicies('automation_runs', ownArea, ALL),
  ...systemPolicies('automation_runs', ALL),
  ...corePolicies('events', everyArea, ['SELECT', 'INSERT']),
  ...systemPolicies('events', ALL),
]

/**
 * Foreign keys row security relies on: a point's stored area is trustworthy only while this key
 * holds it to its signal's (validated, enforced, both actions cascading). The catalog check
 * verifies each, with its referenced unique key, before runtime admission. The models declare the
 * same keys (signals/models.ts; a test compares them).
 */
export interface RowForeignKey { table: string; columns: readonly string[]; references: { table: string; columns: readonly string[] } }
export const ROW_FOREIGN_KEYS: readonly RowForeignKey[] = [
  { table: 'signal_points', columns: ['signal_id', 'area'], references: { table: 'signals', columns: ['id', 'area'] } },
]

/** The tables with row security, among `tables` (core's models present in this Box). */
export function rowSecurityTables(tables: readonly string[]): string[] {
  const have = new Set(tables)
  return [...new Set(ROW_POLICIES.map((p) => p.table))].filter((t) => have.has(t))
}

/** The CREATE POLICY statement of a contract policy. */
export function createPolicySql(p: RowPolicy): string {
  const parts = [`create policy ${quoteIdent(p.name)} on ${CORE_SCHEMA}.${quoteIdent(p.table)} as permissive for ${p.command.toLowerCase()} to ${p.role}`]
  if (p.using !== null) parts.push(`using (${p.using})`)
  if (p.check !== null) parts.push(`with check (${p.check})`)
  return parts.join(' ')
}

/** One policy as compared: `name|permissive|roles|command|using|check`, the server's text. */
function policyLine(p: { name: string; permissive: string; roles: string; command: string; using: string | null; check: string | null }): string {
  return `${p.name}|${p.permissive}|${p.roles}|${p.command}|${p.using ?? ''}|${p.check ?? ''}`
}

/** The contract's lines for `table`, sorted. */
export function contractLines(table: string): string[] {
  return ROW_POLICIES.filter((p) => p.table === table)
    .map((p) => policyLine({ name: p.name, permissive: 'PERMISSIVE', roles: `{${p.role}}`, command: p.command, using: p.using, check: p.check }))
    .sort()
}

/**
 * Earlier shipped contracts a boot may replace, per table (each a sorted line list). A change to
 * ROW_POLICIES adds the previous lines here in the same commit; anything else found on an installed
 * table is drift and refuses boot. Empty: the first contract (storage phase 1 W8).
 */
export const PRIOR_ROW_POLICIES: Readonly<Record<string, readonly (readonly string[])[]>> = {}

export class RowSecurityDrift extends Error {
  constructor(readonly problems: string[]) {
    super(`row security does not match the contract: ${problems.join('; ')}`)
    this.name = 'RowSecurityDrift'
  }
}

/**
 * The persisted install record: one row per table row security was installed on. Without it, a
 * table stripped of both its policies and row security would look like a first install and be
 * silently re-armed (BOX-Review of ca251a1, residual R2). Owner-only (no runtime grant).
 */
export const ROW_SECURITY_LEDGER = 'row_security_ledger'

/**
 * Install row security on the listed core tables present, or confirm it (owner session, inside the
 * schema transaction). A table with neither row security nor policies, and no install record, is
 * installed and recorded; a table holding
 * exactly the contract is left alone; one holding an earlier shipped contract (PRIOR_ROW_POLICIES)
 * is replaced. Anything else (an extra, edited or missing policy, row security off or forced beside
 * policies) refuses with RowSecurityDrift: boot never repairs drift silently (BOX-Review W8 R1/R2
 * finding 1).
 */
export async function applyRowSecurity(c: Queryable, tables: readonly string[]): Promise<void> {
  const ledger = `${CORE_SCHEMA}.${ROW_SECURITY_LEDGER}`
  await c.query(`create table if not exists ${ledger} (table_name text primary key, installed_at timestamptz not null default now())`)
  const installed = new Set(((await c.query(`select table_name from ${ledger}`)) as { rows: { table_name: string }[] }).rows.map((r) => r.table_name))
  const problems: string[] = []
  const plan: { table: string; replace: string[] }[] = []
  const record: string[] = []
  for (const table of rowSecurityTables(tables)) {
    const rel = (await c.query(`select c.relrowsecurity rls, c.relforcerowsecurity f from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`, [CORE_SCHEMA, table])) as { rows: { rls: boolean; f: boolean }[] }
    const pol = (await c.query(`select policyname name, permissive, roles::text roles, cmd command, qual, with_check from pg_policies where schemaname = $1 and tablename = $2`, [CORE_SCHEMA, table])) as {
      rows: { name: string; permissive: string; roles: string; command: string; qual: string | null; with_check: string | null }[]
    }
    const lines = pol.rows.map((p) => policyLine({ ...p, using: p.qual, check: p.with_check })).sort()
    const { rls, f } = rel.rows[0] ?? { rls: false, f: false }
    const want = contractLines(table)
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
    if (!rls && !f && lines.length === 0 && !installed.has(table)) plan.push({ table, replace: [] })
    else if (rls && !f && same(lines, want)) record.push(table)
    else if (rls && !f && (PRIOR_ROW_POLICIES[table] ?? []).some((prior) => same(lines, prior))) plan.push({ table, replace: pol.rows.map((p) => p.name) })
    else if (!rls && !f && lines.length === 0) problems.push(`${CORE_SCHEMA}.${table}: row security and every policy removed after install`)
    else {
      const extra = lines.filter((l) => !want.includes(l)).map((l) => l.split('|')[0])
      const missing = want.filter((l) => !lines.includes(l)).map((l) => l.split('|')[0])
      problems.push(`${CORE_SCHEMA}.${table}: ${[!rls ? 'row security off' : '', f ? 'row security forced' : '', extra.length ? `unexpected or changed ${extra.join(', ')}` : '', missing.length ? `missing ${missing.join(', ')}` : ''].filter(Boolean).join(', ')}`)
    }
  }
  if (problems.length) throw new RowSecurityDrift(problems)
  for (const { table, replace } of plan) {
    const qualified = `${CORE_SCHEMA}.${quoteIdent(table)}`
    await c.query(`alter table ${qualified} enable row level security`)
    for (const name of replace) await c.query(`drop policy ${quoteIdent(name)} on ${qualified}`)
    for (const p of ROW_POLICIES.filter((x) => x.table === table)) await c.query(createPolicySql(p))
    record.push(table)
  }
  for (const table of record) await c.query(`insert into ${ledger} (table_name) values ($1) on conflict (table_name) do nothing`, [table])
}
