// Seed the Box's agent principals before human bootstrap; never rename an existing account.
//
// The agent files (agents.ts) say which agents exist; the users rows are their durable record.
// Boot reconciliation only writes rows: it upserts every configured agent, retires agent rows whose
// file is gone and restores the ones whose file came back. Whether an agent may act is decided at
// call time by the eligibility predicate, so deleting a file takes effect before the next boot.
import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'
import { readUser, upsertUser } from '../users/state.js'
import { agentIdentity, bindAgentIdentity, isMaintenanceBoot, systemUserId } from '../box-config.js'
import { rmSync } from 'node:fs'
import { AgentFileError, agentFileProblems, configuredAgents, writeNewAgentFile, type NewAgentFile } from '../agents.js'
import type { User } from '../users/types.js'
import { revokePrincipalToken } from './principal.js'
import { interruptedAgentRestore } from '../warehouse/agent-snapshot.js'

/** Whether any person exists. Agents do not count, even when configured as admins. */
export async function hasHumanUsers(): Promise<boolean> {
  await ensureSchema()
  const rows = await withRead<{ n: number }>(
    `SELECT count(*) AS n FROM users WHERE coalesce(kind, 'human') <> 'agent' AND id <> ?`,
    [systemUserId()],
  )
  return Number(rows[0]?.n ?? 0) > 0
}

export interface AgentReconciliation {
  /** Agent rows created on this boot. */
  created: string[]
  /** Agent rows whose file is gone, retired on this boot. */
  retired: string[]
  /** Retired agent rows whose file is back, restored on this boot. */
  restored: string[]
}

/**
 * Upsert every configured agent (name and role from config, `kind = 'agent'`; nickname = name and
 * `sort 99` on create; other fields and credentials preserved), the system principal first. Refuses, before any write,
 * when an agent file does not parse or names the id of a person. Retires `kind = 'agent'` rows
 * without a file (revoked: tokens stop, `run_as` refused; the row stays as their messages' author)
 * and restores a retired row whose file is back (status active, a fresh token on its next session).
 * A maintenance boot skips retirement: a restore may be staged and the files not back yet.
 */
export async function ensureAgentPrincipals(): Promise<AgentReconciliation> {
  await ensureSchema()
  const interrupted = interruptedAgentRestore()
  if (interrupted) throw new Error(interrupted)
  const problems = agentFileProblems()
  if (problems.length) throw new Error(`agent files do not parse; fix them before booting:\n  ${problems.join('\n  ')}`)
  const system = agentIdentity()
  const agents = configuredAgents()
  const existing = await readUser(system.id)
  if (!existing && await hasHumanUsers()) {
    throw new Error('configured agent does not exist in this populated Box; restore its original agent.id before booting')
  }
  const rows = await withRead<{ id: string; kind: string | null; status: string }>(`SELECT id, kind, status FROM users`)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const clash = agents.filter((a) => !a.system && byId.has(a.id) && byId.get(a.id)!.kind !== 'agent')
  if (clash.length) {
    throw new Error(
      `agent file${clash.length > 1 ? 's' : ''} ${clash.map((a) => `data/config/agents/${a.id}.md`).join(', ')} ` +
        `name${clash.length > 1 ? '' : 's'} an existing person; rename the file (an agent id must be new), or convert the account with a deliberate transition script`,
    )
  }
  bindAgentIdentity()
  const result: AgentReconciliation = { created: [], retired: [], restored: [] }
  for (const agent of agents) {
    const prev = byId.get(agent.id)
    await upsertUser(
      // Config owns the name and role; last name and nickname are set once and then the profile's.
      { id: agent.id, first_name: agent.name, role: agent.role, ...(prev ? {} : { last_name: '', nickname: agent.name, sort: 99 }) },
      { kind: 'agent' },
    )
    if (!prev) result.created.push(agent.id)
    else if (!agent.system && prev.status === 'revoked') {
      // The retirement this reconciliation set (an agent cannot be disabled any other way): clear
      // it, and drop the old token with it so a copy that leaked while retired stays dead.
      await withWrite(async (conn) => {
        await conn.run(
          `UPDATE users SET status = 'active', token_revoked_at = NULL, token_ciphertext = NULL, updated_at = now() WHERE id = ?`,
          [agent.id],
        )
      })
      result.restored.push(agent.id)
    }
  }
  if (!isMaintenanceBoot()) {
    const configured = new Set(agents.map((a) => a.id))
    for (const row of rows) {
      if (row.kind !== 'agent' || configured.has(row.id) || row.status === 'revoked') continue
      await revokePrincipalToken(row.id)
      result.retired.push(row.id)
    }
  }
  if (result.created.length) console.info(`agents: created ${result.created.join(', ')}`)
  if (result.restored.length) console.info(`agents: restored ${result.restored.join(', ')} (file is back)`)
  if (result.retired.length) console.info(`agents: retired ${result.retired.join(', ')} (no file in data/config/agents/)`)
  return result
}

/**
 * Create an agent at runtime (Settings > Users > New agent, a person who is an admin at a browser
 * session; the caller checks that). Refuses the id of an existing person or active agent; a retired
 * agent's id brings that agent back (its row, messages and runs are kept). Writes the file, then
 * reconciles exactly like a boot; a reconciliation that fails removes the file again.
 */
export async function createAgent(input: NewAgentFile): Promise<User> {
  const prev = await readUser(input.id)
  if (prev && prev.kind !== 'agent') throw new AgentFileError(`data/config/agents/${input.id}.md`, `"${input.id}" is a person's id; an agent id must be new`)
  if (prev && prev.status !== 'revoked') throw new AgentFileError(`data/config/agents/${input.id}.md`, `agent "${input.id}" exists already`)
  const file = writeNewAgentFile(input)
  try {
    await ensureAgentPrincipals()
  } catch (error) {
    rmSync(file, { force: true })
    throw error
  }
  const user = await readUser(input.id)
  if (!user) throw new Error(`agent "${input.id}" was not created`)
  return user
}
