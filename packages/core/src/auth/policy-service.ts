// The serialized policy service (PERMISSIONS 7.2, 9.2): every change to who may reach what, and
// to where agents may write, goes through here. A change is previewed against the coverage rule
// (decision B: every reader of a destination covers its agent) and applied under the one policy
// lock (warehouse/pg/boot.ts policyCommand): the apply recomputes coverage there and refuses when
// the caller's preview revision moved.
//
// - Role rows, user roles and the policy tables of features (chat's mode, members and agent seats)
//   commit in ONE PostgreSQL transaction on box_policy, with the login reconcile and the revision.
// - Agent config and toolsets are files. Such a change is applied from the policy journal
//   (core.policy_journal): with the policy gate closed (policy-gate.ts) the database part and the
//   journal row commit, sessions of the changed agents and toolsets end, the files are written, and
//   a second command marks the entry done and bumps the revision; the gate then opens. Boot
//   resumes an unfinished entry (or rolls it back when its target no longer exists).
// - Destinations come from coverage providers that features register (chat's rooms, the artifacts'
//   area destinations): a reader set (member ids, or everyone with read on an area) and the
//   agents that write there with the connections they can use there.
//
// A preview reports only the violations a change would add, including a tuple that was already
// broken whose gaps grow; what already broke (agent config edited by hand) is found by the boot
// check, which disables the seats concerned.

import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { configuredAgents } from '../agents.js'
import { toolsetConnections, toolsetEntry, toolsetEntryServers, writeToolsetEntry } from '../agent-tools.js'
import { systemUserId } from '../box-config.js'
import { policyCommand, policyRead, withAgentsLock, type PolicyTx } from '../warehouse/pg/boot.js'
import { levelCovers, levelOf, type Access } from './access.js'
import { coverageGaps, describeGap, type CoverageGap, type CoverageOptions } from './covers.js'
import { holdPolicyGate, releasePolicyGateHold, withPolicyGate } from './policy-gate.js'
import { policyRevision } from './policy-revision.js'
import { activePrincipalsWithRevision, assignRoleInTx } from './principal.js'
import { activeRecipients } from './recipients.js'
import { BUILTIN_ROLES, roleDefinitionFromRow, validateRole, writeRoleInTx, type RoleDefinition } from './roles.js'
import { closeSessionsWhere } from './session-credential.js'


// ---- Changes, destinations, violations ----

export type { PolicyChange, DestinationReaders, CoverageDestination, CoverageViolation, CoverageProvider, CoverageContext } from './coverage-registry.js'
export { registerCoverageProvider, registerAreaDestination, areaDestinationList, registerScopeCoverage } from './coverage-registry.js'
import { areaDestinationLabel, coverageProviders, scopeCoverageChecks, type CoverageDestination, type CoverageViolation, type DestinationReaders, type PolicyChange, type CoverageContext } from './coverage-registry.js'

// ---- Errors ----

/** The answer a preview or a refused apply gives. */
export interface PolicyPreview {
  /** The policy revision the preview was computed at; an apply with `confirm` must repeat it. */
  revision: number
  violations: CoverageViolation[]
  /** One line per violation: "Dita (sales) lacks crm write held by Nova in #pipeline". */
  messages: string[]
  /** `remove-members` when every violation can be fixed by dropping those members; null otherwise. */
  confirm: 'remove-members' | null
  /** What the admin can do: apply, cancel, remove these members, change these grants. */
  options: ('apply' | 'cancel' | 'remove-members' | 'change-grants')[]
}

/** Coverage would break: refused, with the list (409). */
export class CoverageRefusedError extends Error {
  readonly status = 409
  constructor(readonly preview: PolicyPreview) {
    super(`refused: the change breaks agent coverage:\n  ${preview.messages.join('\n  ')}${preview.confirm ? `\nrepeat it with confirm: 'remove-members' and revision ${preview.revision} to also remove these members` : '\ncancel, or change these grants'}`)
    this.name = 'CoverageRefusedError'
  }

  toJSON(): Record<string, unknown> {
    return { error: 'coverage', ...this.preview }
  }
}

/** The policy moved since the preview the caller confirmed (409): preview again. */
export class PolicyRevisionMovedError extends Error {
  readonly status = 409
  constructor(readonly expected: number, readonly revision: number) {
    super(`refused: the access policy changed since the preview (revision ${expected}, now ${revision}); preview the change again`)
    this.name = 'PolicyRevisionMovedError'
  }

  toJSON(): Record<string, unknown> {
    return { error: 'policy_revision_moved', expected: this.expected, revision: this.revision }
  }
}

// ---- The world a change is judged in ----

interface UserRow { id: string; kind: string | null; role: string | null; status: string }

interface World {
  defs: Map<string, RoleDefinition>
  users: Map<string, UserRow>
  agents: Map<string, string>
  toolsets: Record<string, Record<string, unknown> | null>
}

const ELIGIBLE = new Set(['active', 'invited'])
const isPerson = (u: UserRow): boolean => u.id !== systemUserId() && (u.kind ?? 'human') === 'human'

function accessOfRole(world: World, role: string): Access {
  const def = world.defs.get(role)
  if (!def) return { role, areas: new Map(), fallback: 'none', admin: false, revision: 0 }
  return { role, areas: new Map(Object.entries(def.areas)), fallback: def.default, admin: role === 'admin', revision: 0 }
}

function connectionsIn(world: World, toolset: string | null | undefined): string[] {
  if (!toolset) return []
  if (Object.prototype.hasOwnProperty.call(world.toolsets, toolset)) return toolsetEntryServers(world.toolsets[toolset] ?? null)
  return toolsetConnections(toolset)
}

async function worldIn(tx: PolicyTx, change: PolicyChange): Promise<World> {
  const defs = new Map<string, RoleDefinition>(BUILTIN_ROLES.map((r) => [r.id, r]))
  const rows = await tx.query<{ id: string; label: string; description: string | null; default_level: string; areas: unknown }>(`select id, label, description, default_level, areas from core.roles`)
  for (const r of rows) defs.set(r.id, roleDefinitionFromRow(r as never))
  for (const input of change.roles?.upsert ?? []) {
    const role = validateRole(input)
    defs.set(role.id, { ...role, description: role.description ?? '', builtin: false })
  }
  const users = new Map((await tx.query<UserRow>(`select id, kind, role, status from core.users`)).map((u) => [u.id, u]))
  for (const [id, role] of Object.entries(change.users ?? {})) {
    const u = users.get(id)
    if (!u) throw new Error(`no user "${id}"`)
    users.set(id, { ...u, role, status: u.status === 'pending' ? 'active' : u.status })
  }
  for (const id of change.reactivate ?? []) {
    const u = users.get(id)
    if (!u) throw new Error(`no user "${id}"`)
    if (u.status === 'revoked') users.set(id, { ...u, status: 'active' })
  }
  const agents = new Map<string, string>()
  for (const a of configuredAgents()) agents.set(a.id, a.role)
  for (const [id, role] of Object.entries(change.agents ?? {})) {
    if (!agents.has(id)) throw new Error(`no agent "${id}"`)
    agents.set(id, role)
  }
  return { defs, users, agents, toolsets: { ...change.toolsets } }
}

function contextOf(world: World): CoverageContext {
  return {
    isAgent: (id) => world.agents.has(id) && ELIGIBLE.has(world.users.get(id)?.status ?? 'active'),
    connections: (toolset) => connectionsIn(world, toolset),
  }
}

function readersOf(world: World, readers: DestinationReaders): UserRow[] {
  const eligible = [...world.users.values()].filter((u) => isPerson(u) && ELIGIBLE.has(u.status))
  const reads = (u: UserRow, area: string) => levelCovers(levelOf(accessOfRole(world, u.role ?? 'member'), area), 'read')
  if (readers.kind === 'area') return eligible.filter((u) => reads(u, readers.area))
  const ids = new Set(readers.ids)
  return eligible.filter((u) => ids.has(u.id) && (!readers.area || reads(u, readers.area)))
}

/** An area destination's own area compares at read (covers.ts `destinationArea`); members destinations compare exactly. */
function areaOf(readers: DestinationReaders): CoverageOptions {
  return readers.kind === 'area' ? { destinationArea: readers.area } : {}
}

function violationsIn(world: World, destinations: readonly CoverageDestination[]): CoverageViolation[] {
  const out: CoverageViolation[] = []
  for (const d of destinations) {
    const readers = readersOf(world, d.readers)
    const joining = new Set(d.readers.kind === 'members' ? d.readers.joining ?? [] : [])
    for (const agent of d.agents) {
      const role = world.agents.get(agent.id)
      if (role === undefined) continue
      const agentAccess = accessOfRole(world, role)
      for (const reader of readers) {
        const readerRole = reader.role ?? 'member'
        const gaps = coverageGaps({ id: reader.id, kind: 'human', access: accessOfRole(world, readerRole) }, agentAccess, agent.connections, areaOf(d.readers))
        if (gaps.length === 0) continue
        out.push({ destination: d.key, label: d.label, reader: reader.id, readerRole, agent: agent.id, gaps, removable: d.readers.kind === 'members' && !joining.has(reader.id) })
      }
    }
  }
  return out
}

async function destinationsIn(tx: PolicyTx, change: PolicyChange, world: World): Promise<CoverageDestination[]> {
  const ctx = contextOf(world)
  const out: CoverageDestination[] = []
  for (const provider of coverageProviders()) out.push(...(await provider.destinations(tx, change, ctx)))
  return out
}

const keyOf = (v: CoverageViolation) => `${v.destination}\u0000${v.reader}\u0000${v.agent}`

/** Whether `gap` is missing from, or worse than anything in, the gaps a tuple already had. */
function gapIsNew(gap: CoverageGap, had: readonly CoverageGap[]): boolean {
  if (gap.kind === 'admin') return !had.some((g) => g.kind === 'admin')
  if (gap.kind === 'connection') return !had.some((g) => g.kind === 'connection' && g.connection === gap.connection)
  const was = had.find((g): g is Extract<CoverageGap, { kind: 'area' }> => g.kind === 'area' && g.area === gap.area)
  return !was || !levelCovers(was.needed, gap.needed) || !levelCovers(gap.held, was.held)
}

/**
 * The violations `change` would add (those the current policy already has are not its doing): a new
 * destination, reader and agent tuple, or an already broken tuple whose gaps grow (a further area,
 * a higher level needed, less held, another connection).
 */
async function newViolations(tx: PolicyTx, change: PolicyChange): Promise<CoverageViolation[]> {
  const before = await worldIn(tx, {})
  const existing = new Map(violationsIn(before, await destinationsIn(tx, {}, before)).map((v) => [keyOf(v), v.gaps]))
  const after = await worldIn(tx, change)
  return violationsIn(after, await destinationsIn(tx, change, after)).filter((v) => {
    const had = existing.get(keyOf(v))
    return !had || v.gaps.some((gap) => gapIsNew(gap, had))
  })
}

async function allViolations(tx: PolicyTx): Promise<CoverageViolation[]> {
  const world = await worldIn(tx, {})
  return violationsIn(world, await destinationsIn(tx, {}, world))
}

// ---- Messages ----

/** "Dita (sales) lacks crm write held by Nova in #pipeline", one per violation. */
export async function describeViolations(violations: readonly CoverageViolation[]): Promise<string[]> {
  if (violations.length === 0) return []
  const names = new Map<string, string>()
  try {
    for (const p of (await activePrincipalsWithRevision()).principals) names.set(p.id, p.display)
  } catch {
    // Names are a courtesy: ids stand in when the directory cannot be read.
  }
  for (const a of configuredAgents()) if (!names.has(a.id)) names.set(a.id, a.name)
  const name = (id: string) => names.get(id) ?? id
  return violations.map((v) => `${name(v.reader)} (${v.readerRole}) lacks ${v.gaps.map(describeGap).join(', ')} held by ${name(v.agent)} in ${v.label}`)
}

async function previewOf(revision: number, violations: CoverageViolation[]): Promise<PolicyPreview> {
  const removable = violations.length > 0 && violations.every((v) => v.removable)
  const options: PolicyPreview['options'] = violations.length === 0 ? ['apply'] : removable ? ['cancel', 'remove-members'] : ['cancel', 'change-grants']
  return { revision, violations, messages: await describeViolations(violations), confirm: removable ? 'remove-members' : null, options }
}

// ---- Preview and apply ----

/** The coverage violations `change` would cause, at the current revision. Changes nothing. */
export async function previewPolicyChange(change: PolicyChange): Promise<PolicyPreview> {
  const { revision, violations } = await policyRead(`preview ${change.reason ?? 'policy change'}`, async (tx) => ({ revision: tx.revision, violations: await newViolations(tx, change) }))
  return previewOf(revision, violations)
}

export interface PolicyApplyOptions {
  /** The revision of the preview the caller saw; the apply refuses when the policy moved since. Required with `confirm`. */
  revision?: number
  /** Also remove the members the preview listed (members destinations only). */
  confirm?: 'remove-members'
  /**
   * `disable`: instead of refusing, disable the seats concerned and report them (a new or
   * reactivated user against seated agents, PERMISSIONS 7.2). Default `refuse`.
   */
  onViolation?: 'refuse' | 'disable'
}

export interface PolicyApplyResult {
  /** The revision the change committed at. */
  revision: number
  /** Members removed with `confirm: 'remove-members'`. */
  removed: CoverageViolation[]
  /** Seats disabled (`onViolation: 'disable'`), with the reasons. */
  disabled: CoverageViolation[]
  messages: string[]
}

class Refusal extends Error {
  constructor(readonly revision: number, readonly violations: CoverageViolation[]) {
    super('coverage refused')
  }
}

const hasFiles = (change: PolicyChange): boolean => Object.keys(change.agents ?? {}).length > 0 || Object.keys(change.toolsets ?? {}).length > 0

/**
 * Apply `change` under the policy lock: recompute coverage, refuse when the preview revision moved
 * or a violation remains (unless confirmed and removable), write every part, bump the revision.
 * Throws CoverageRefusedError (with the preview) or PolicyRevisionMovedError.
 */
export async function applyPolicyChange(change: PolicyChange, opts: PolicyApplyOptions = {}): Promise<PolicyApplyResult> {
  if (opts.confirm && opts.revision === undefined) throw new Error("confirm: 'remove-members' needs the revision of the preview it confirms")
  try {
    const result = hasFiles(change) ? await withPolicyGate(() => applyWithJournal(change, opts)) : await applyInDatabase(change, opts)
    return { ...result, messages: await describeViolations([...result.removed, ...result.disabled]) }
  } catch (error) {
    if (error instanceof Refusal) throw new CoverageRefusedError(await previewOf(error.revision, error.violations))
    throw error
  }
}

interface Decided {
  removed: CoverageViolation[]
  disabled: CoverageViolation[]
  after: (() => void)[]
}

/** Inside the policy transaction: the revision check, coverage, and every database part of `change`. */
async function decideAndWrite(tx: PolicyTx, change: PolicyChange, opts: PolicyApplyOptions): Promise<Decided> {
  await refuseUnfinishedJournal(tx)
  if (opts.revision !== undefined && opts.revision !== tx.revision) throw new PolicyRevisionMovedError(opts.revision, tx.revision)
  const violations = await newViolations(tx, change)
  const decided: Decided = { removed: [], disabled: [], after: [] }
  if (violations.length > 0) {
    if (opts.onViolation === 'disable') {
      decided.disabled = violations
    } else if (opts.confirm === 'remove-members' && violations.every((v) => v.removable)) {
      decided.removed = violations
    } else {
      throw new Refusal(tx.revision, violations)
    }
  }
  for (const input of change.roles?.upsert ?? []) await writeRoleInTx(tx, validateRole(input), change.actor)
  for (const [id, role] of Object.entries(change.users ?? {})) await assignRoleInTx(tx, id, role, change.actor, { create: change.create })
  for (const id of change.reactivate ?? []) {
    await tx.run(`update core.users set status = 'active', updated_at = now(), updated_by = $1 where id = $2 and status = 'revoked'`, [change.actor ?? null, id])
  }
  const removals = new Map<string, string[]>()
  for (const v of decided.removed) removals.set(v.destination, [...(removals.get(v.destination) ?? []), v.reader])
  for (const provider of coverageProviders()) {
    const after = await provider.apply?.(tx, change, removals)
    if (after) decided.after.push(after)
  }
  if (decided.disabled.length) {
    const messages = await describeViolations(decided.disabled)
    for (const provider of coverageProviders()) {
      const after = await provider.disable?.(tx, decided.disabled, messages)
      if (after) decided.after.push(after)
    }
  }
  return decided
}

function runAfter(after: readonly (() => void)[]): void {
  for (const fn of after) {
    try {
      fn()
    } catch (error) {
      console.error('[policy] after-commit step failed:', error)
    }
  }
}

async function applyInDatabase(change: PolicyChange, opts: PolicyApplyOptions): Promise<Omit<PolicyApplyResult, 'messages'>> {
  const decided = await policyCommand(change.reason ?? 'policy change', (tx) => decideAndWrite(tx, change, opts))
  runAfter(decided.after)
  return { revision: policyRevision(), removed: decided.removed, disabled: decided.disabled }
}

/** A user row as the policy login reads it. */
export type PolicyUserRow = UserRow

/**
 * The status half of an explicit credential restore (issuePrincipalToken), as ONE policy command:
 * `id`'s row is locked and judged by `check` at the state it has under the lock, a revoked person is
 * reactivated with coverage judged against the policy as it is then (seats they do not cover are
 * disabled and reported), and the token revocation is cleared in the same commit. A status change
 * since the first read (a revocation or retirement of an active principal) is refused by `check`; a
 * role change is judged here. A second revocation of an already-revoked person changes no status and
 * is not told apart, but the activation it precedes is still judged by the coverage rule.
 */
export async function restorePrincipalCredential(id: string, actor: string | undefined, check: (row: PolicyUserRow) => void): Promise<PolicyApplyResult> {
  const reason = `reactivate ${id}`
  const decided = await policyCommand(reason, async (tx) => {
    const row = (await tx.query<UserRow>(`select id, kind, role, status from core.users where id = $1 for update`, [id]))[0]
    if (!row) throw new Error(`no user "${id}"`)
    check(row)
    const d: Decided = row.status === 'revoked' ? await decideAndWrite(tx, { reason, actor, reactivate: [id] }, { onViolation: 'disable' }) : { removed: [], disabled: [], after: [] }
    await tx.run(`update core.users set token_revoked_at = null, updated_at = now(), updated_by = $1 where id = $2`, [actor ?? null, id])
    return d
  })
  runAfter(decided.after)
  return { revision: policyRevision(), removed: decided.removed, disabled: decided.disabled, messages: await describeViolations(decided.disabled) }
}

// ---- The journal: file-backed parts ----

/** One file a journaled change writes, with its contents before and after. */
export type JournalItem =
  | { kind: 'agent-role'; id: string; file: string; role: string; before: string; after: string }
  | { kind: 'toolset'; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

/** Test seams: throw from one to stop a journaled change at that stage (a crash). */
export interface PolicyJournalHooks {
  /** The database part and the journal row committed; sessions not ended, files not written. */
  afterPrepare?: (id: string) => void | Promise<void>
  /** Sessions ended; files not written. */
  afterSessions?: (id: string) => void | Promise<void>
  /** Files written; the entry is not marked done. */
  afterFiles?: (id: string) => void | Promise<void>
  /** Before the terminal stage is recorded: throw to fail that transaction (a lost connection). */
  beforeFinish?: (id: string, stage: 'done' | 'rolled-back') => void | Promise<void>
  /** Before each file is written (to its `after`, or back to its `before`): throw to fail that write. */
  beforeWrite?: (item: JournalItem, side: 'before' | 'after') => void
}

let journalHooks: PolicyJournalHooks = {}
export function setPolicyJournalHooks(next: PolicyJournalHooks): void {
  journalHooks = next
}

async function refuseUnfinishedJournal(tx: PolicyTx): Promise<void> {
  const open = await tx.query<{ id: string; reason: string }>(`select id, reason from core.policy_journal where stage = 'prepared' order by created_at limit 1`)
  if (open[0]) throw new Error(`refused: policy change "${open[0].reason}" (journal ${open[0].id}) is not finished; it resumes at the next boot (or now: box restart)`)
}

async function planOf(change: PolicyChange): Promise<JournalItem[]> {
  const { agentFileWithRole } = await import('../agents.js')
  const items: JournalItem[] = []
  for (const [id, role] of Object.entries(change.agents ?? {})) {
    const { file, before, after } = agentFileWithRole(id, role)
    items.push({ kind: 'agent-role', id, file, role, before, after })
  }
  for (const [id, entry] of Object.entries(change.toolsets ?? {})) items.push({ kind: 'toolset', id, before: toolsetEntry(id), after: entry })
  return items
}

function writeFileAtomic(file: string, text: string): void {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, text, { mode: 0o644 })
  renameSync(temp, file)
}

async function writeItems(items: readonly JournalItem[], side: 'before' | 'after'): Promise<void> {
  const agents = items.filter((i) => i.kind === 'agent-role')
  const write = () => {
    for (const item of items) {
      journalHooks.beforeWrite?.(item, side)
      if (item.kind === 'agent-role') writeFileAtomic(item.file, item[side])
      else writeToolsetEntry(item.id, item[side])
    }
  }
  if (agents.length) await withAgentsLock(async () => write())
  else write()
}

async function finishEntry(tx: PolicyTx, id: string, items: readonly JournalItem[], stage: 'done' | 'rolled-back' | 'abandoned', detail: string | null): Promise<void> {
  if (stage === 'done') {
    for (const item of items) {
      if (item.kind === 'agent-role') await tx.run(`update core.users set role = $1, updated_at = now() where id = $2 and kind = 'agent'`, [item.role, item.id])
    }
  }
  const n = await tx.run(`update core.policy_journal set stage = $2, detail = $3, finished_at = now() where id = $1 and stage = 'prepared'`, [id, stage, detail])
  if (n !== 1) throw new Error(`policy journal entry ${id} is not waiting to finish`)
}

function endSessionsOf(items: readonly JournalItem[]): string[] {
  const agents = new Set(items.filter((i) => i.kind === 'agent-role').map((i) => i.id))
  const toolsets = new Set(items.filter((i) => i.kind === 'toolset').map((i) => i.id))
  return closeSessionsWhere((g) => agents.has(g.sub) || (g.toolset !== null && toolsets.has(g.toolset)))
}

async function applyWithJournal(change: PolicyChange, opts: PolicyApplyOptions): Promise<Omit<PolicyApplyResult, 'messages'>> {
  const reason = change.reason ?? 'policy change'
  const items = await planOf(change)
  const id = randomUUID()
  // 1. Under the lock: coverage, the database part, and the journal row, in one commit.
  const decided = await policyCommand(reason, async (tx) => {
    const d = await decideAndWrite(tx, change, opts)
    await tx.run(`insert into core.policy_journal (id, reason, plan, stage) values ($1, $2, $3::jsonb, 'prepared')`, [id, reason, JSON.stringify(items)])
    return d
  })
  runAfter(decided.after)
  // From here the entry is prepared. Until a terminal stage is recorded (done, or rolled back with
  // the files positively restored), any error leaves the gate held: the files and the database may
  // disagree, and only recovery (recoverPolicyJournal, at boot) can tell which side committed.
  let terminal = false
  try {
    await journalHooks.afterPrepare?.(id)
    // 2. Sessions of the changed agents and toolsets end (the gate holds new calls meanwhile).
    endSessionsOf(items)
    await journalHooks.afterSessions?.(id)
    // 3. The files.
    try {
      await writeItems(items, 'after')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await writeItems(items, 'before')
      } catch (undoError) {
        // Some files may be as after, some as before: not a rollback. The entry stays prepared.
        const detail = `writing its files failed (${message}); restoring them failed (${undoError instanceof Error ? undoError.message : String(undoError)})`
        await policyCommand(`${reason}: unresolved`, (tx) => tx.run(`update core.policy_journal set detail = $2 where id = $1 and stage = 'prepared'`, [id, detail])).catch((e: unknown) => console.error(`[policy] journal ${id}: could not record the failure:`, e))
        throw new Error(`policy change "${reason}" is unresolved: ${detail}`)
      }
      await journalHooks.beforeFinish?.(id, 'rolled-back')
      await policyCommand(`${reason}: rolled back`, (tx) => finishEntry(tx, id, items, 'rolled-back', message))
      terminal = true
      throw new Error(`policy change "${reason}" rolled back: writing its files failed (${message})`)
    }
    await journalHooks.afterFiles?.(id)
    // 4. Done: the agent rows' roles, the entry, and a revision after the files.
    await journalHooks.beforeFinish?.(id, 'done')
    await policyCommand(`${reason}: files written`, (tx) => finishEntry(tx, id, items, 'done', null))
    terminal = true
  } catch (error) {
    if (terminal) throw error
    const message = error instanceof Error ? error.message : String(error)
    holdPolicyGate(`policy change "${reason}" (journal ${id}) is unresolved: ${message}; it is reconciled at the next boot (box restart)`)
    throw new Error(`${message}. Agent sessions stay refused until journal ${id} is reconciled (box restart).`)
  }
  return { revision: policyRevision(), removed: decided.removed, disabled: decided.disabled }
}

/** What boot did with unfinished journal entries. */
export interface JournalRecovery {
  resumed: string[]
  rolledBack: string[]
  abandoned: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function currentOf(item: JournalItem): unknown {
  if (item.kind === 'toolset') return toolsetEntry(item.id)
  try {
    return readFileSync(item.file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Finish what a crash or a failed restore interrupted (boot, before agent reconciliation), and
 * release the gate an unresolved change held once every entry is finished: an entry whose files are
 * still as before or already as after is resumed (the files written, the entry done), unless an
 * agent's new role no longer exists, which rolls it back (files as before). Files changed by hand
 * since leave the entry abandoned (the boot coverage check then judges what is there).
 */
export async function recoverPolicyJournal(): Promise<JournalRecovery> {
  const out: JournalRecovery = { resumed: [], rolledBack: [], abandoned: [] }
  const open = await policyRead('policy journal recovery', (tx) => tx.query<{ id: string; reason: string; plan: unknown }>(`select id, reason, plan from core.policy_journal where stage = 'prepared' order by created_at`))
  if (open.length === 0) {
    releasePolicyGateHold()
    return out
  }
  const { roleExists } = await import('./roles.js')
  for (const row of open) {
    const items = (typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan) as JournalItem[]
    const states = items.map((item) => {
      const now = currentOf(item)
      return same(now, item.after) ? 'after' : same(now, item.before) ? 'before' : 'other'
    })
    let stage: 'done' | 'rolled-back' | 'abandoned'
    let detail: string | null = null
    if (states.includes('other')) {
      stage = 'abandoned'
      detail = 'files changed by hand since the change began'
    } else {
      const missing: string[] = []
      for (const item of items) if (item.kind === 'agent-role' && !(await roleExists(item.role))) missing.push(item.role)
      if (missing.length) {
        await writeItems(items, 'before')
        stage = 'rolled-back'
        detail = `role ${missing.join(', ')} no longer exists`
      } else {
        await writeItems(items, 'after')
        stage = 'done'
      }
    }
    await policyCommand(`policy journal recovery ${row.id}`, (tx) => finishEntry(tx, row.id, items, stage, detail))
    if (stage === 'done') out.resumed.push(row.reason)
    else if (stage === 'rolled-back') out.rolledBack.push(row.reason)
    else out.abandoned.push(row.reason)
    console.info(`[policy] journal ${row.id} (${row.reason}): ${stage}${detail ? ` (${detail})` : ''}`)
  }
  // Every entry finished: an unresolved change held the gate until now.
  releasePolicyGateHold()
  return out
}

// ---- Boot check ----

/** What the boot coverage check found: violations it disabled, and those only a person can resolve. */
export interface CoverageCheck {
  disabled: string[]
  unresolved: string[]
}

/**
 * Judge the current policy as it is (agent config edited by hand, a restored backup): every
 * violation is reported; seats whose agent is not covered are disabled until an admin resolves
 * them. Destinations that cannot disable anything (an area's readers, a direct message) are logged
 * and their writes are refused at write time (destination checks).
 */
export async function checkCoverageAtBoot(): Promise<CoverageCheck> {
  const found = await policyRead('coverage boot check', (tx) => allViolations(tx))
  if (found.length === 0) return { disabled: [], unresolved: [] }
  const messages = await describeViolations(found)
  const after = await policyCommand('coverage boot check: disable seats', async (tx) => {
    const now = await allViolations(tx)
    const nowMessages = await describeViolations(now)
    const out: (() => void)[] = []
    for (const provider of coverageProviders()) {
      const fn = await provider.disable?.(tx, now, nowMessages)
      if (fn) out.push(fn)
    }
    return out
  })
  runAfter(after)
  const disabledKeys = new Set(found.filter((v) => v.destination.startsWith('chat:')).map(keyOf))
  const result: CoverageCheck = { disabled: [], unresolved: [] }
  found.forEach((v, i) => (disabledKeys.has(keyOf(v)) ? result.disabled : result.unresolved).push(messages[i]!))
  for (const m of messages) console.warn(`[policy] coverage: ${m}`)
  return result
}

// ---- Write-time checks (PERMISSIONS 7.2 "every live output write checks its destination") ----

/**
 * Who of `readers` would not cover agent `agentId` (with `connections` at the destination), judged
 * now at one committed policy generation. An agent that does not resolve covers nobody: one entry
 * with reader '' and no gaps.
 */
export async function destinationViolations(label: string, readers: DestinationReaders, agentId: string, connections: readonly string[] = []): Promise<CoverageViolation[]> {
  const all = await activeRecipients()
  const agent = all.find((r) => r.principal.id === agentId)
  if (!agent || !agent.access) return [{ destination: label, label, reader: '', readerRole: '', agent: agentId, gaps: [], removable: false }]
  const members = readers.kind === 'members' ? new Set(readers.ids) : null
  const area = readers.kind === 'area' ? readers.area : readers.area
  const out: CoverageViolation[] = []
  for (const r of all) {
    if (r.principal.kind !== 'human' || !r.access) continue
    if (members && !members.has(r.principal.id)) continue
    if (area && !levelCovers(levelOf(r.access, area), 'read')) continue
    const gaps = coverageGaps({ id: r.principal.id, kind: 'human', access: r.access }, agent.access, connections, areaOf(readers))
    if (gaps.length) out.push({ destination: label, label, reader: r.principal.id, readerRole: r.principal.role, agent: agentId, gaps, removable: false })
  }
  return out
}

/** The refusal for an agent's write to a destination whose readers it does not cover, or null. */
export async function destinationWriteProblem(label: string, readers: DestinationReaders, agentId: string, connections: readonly string[] = []): Promise<string | null> {
  const violations = await destinationViolations(label, readers, agentId, connections)
  if (violations.length === 0) return null
  if (violations[0]!.reader === '') return `${agentId} is not an active agent`
  const messages = await describeViolations(violations)
  return `not every reader of ${label} covers ${agentId}: ${messages.join('; ')}`
}

/**
 * Why `readerId` may not read agent `agentId`'s output now, or null. A person is judged as a reader
 * (destinationWriteProblem); an agent as a relay (relayCoverageProblem).
 */
export async function readerCoverageProblem(label: string, readerId: string, agentId: string, connections: readonly string[] = []): Promise<string | null> {
  const relay = await relayCoverageProblem(label, readerId, agentId, connections)
  if (relay !== undefined) return relay
  return destinationWriteProblem(label, { kind: 'members', ids: [readerId] }, agentId, connections)
}

/**
 * Why `reader` may not read the output of a delegated job (WikiAsk, WikiUpdate) run as `agentId`
 * with `connections` (its toolset's), or null. A person is judged as a reader, connections
 * included: they must be in each connection's audience. An agent relays the output into wherever
 * its session writes, and a connection audience of that destination's readers is only proven for
 * the connections the destination's toolset carries (coverage judges those against its readers).
 * So the agent must cover `agentId` on areas, and delegation adds no connection reach: every
 * connection of the job must be one of the reader session's toolset (`reader.toolset`; none for a
 * call outside a session). `people: 'exempt'` passes a person (an update's report goes to whoever
 * sent the material).
 */
export async function delegatedOutputProblem(label: string, reader: { id: string; toolset?: string | null }, agentId: string, connections: readonly string[], opts: { people?: 'judged' | 'exempt' } = {}): Promise<string | null> {
  const relay = await relayCoverageProblem(label, reader.id, agentId)
  if (relay === undefined) return opts.people === 'exempt' ? null : destinationWriteProblem(label, { kind: 'members', ids: [reader.id] }, agentId, connections)
  // No exemption for the job's own principal: the same agent seated in a room reads through that
  // room's session, whose readers were checked only for the room toolset's connections.
  if (relay !== null) return relay
  const carried = new Set(toolsetConnections(reader.toolset))
  const extra = [...new Set(connections)].filter((c) => !carried.has(c))
  if (extra.length === 0) return null
  const where = reader.toolset ? `its toolset ${reader.toolset}` : 'no toolset'
  return `${reader.id} passes ${label} on to its own readers, and ${agentId}'s job can use ${extra.map((c) => `the ${c} connection`).join(', ')}, which ${reader.id}'s session (${where}) does not carry, so its readers were never checked against ${extra.length === 1 ? 'that audience' : 'those audiences'}`
}

/**
 * An agent that reads another agent's output relays it to its own readers (a room agent passing a
 * answer or an update's summary into its room), so it must cover that agent itself: everyone
 * who covers the relay then covers the source too. The refusal, or null when it covers it, or
 * undefined when `relayId` is a person (judged as a reader by the caller's own rule).
 */
export async function relayCoverageProblem(label: string, relayId: string, agentId: string, connections: readonly string[] = []): Promise<string | null | undefined> {
  const all = await activeRecipients()
  const relay = all.find((r) => r.principal.id === relayId)
  if (!relay) return `${relayId} is not active`
  if (relay.principal.kind === 'human') return undefined
  if (relayId === agentId) return null
  const agent = all.find((r) => r.principal.id === agentId)
  if (!agent?.access) return `${agentId} is not an active agent`
  if (!relay.access) return `${relayId} has no access at this policy generation`
  const gaps = coverageGaps({ id: relayId, kind: relay.principal.kind, access: relay.access }, agent.access, connections)
  if (gaps.length === 0) return null
  const messages = await describeViolations([{ destination: label, label, reader: relayId, readerRole: relay.principal.role, agent: agentId, gaps, removable: false }])
  return `${relayId} passes ${label} on to its own readers, so it must cover ${agentId}: ${messages.join('; ')}`
}

/** An agent's output refused at write time (403, no content). */
export class DestinationCoverageError extends Error {
  readonly status = 403
  constructor(message: string) {
    super(message)
    this.name = 'DestinationCoverageError'
  }

  toJSON(): Record<string, unknown> {
    return { error: 'coverage', message: this.message }
  }
}

/** The refusal for agent `agentId` writing in area `area`, or null (not an area destination, or every reader covers it). */
export async function areaDestinationProblem(area: string, agentId: string, connections: readonly string[] = []): Promise<string | null> {
  const label = areaDestinationLabel(area)
  if (!label) return null
  return destinationWriteProblem(label, { kind: 'area', area }, agentId, connections)
}

/** Why a session serving `scope` as `agentId` may no longer run, or null. */
export async function scopeCoverageProblem(scope: string, agentId: string, toolset: string | null): Promise<string | null> {
  for (const [prefix, check] of scopeCoverageChecks()) if (scope.startsWith(prefix)) return check(scope.slice(prefix.length), agentId, toolset)
  return null
}
