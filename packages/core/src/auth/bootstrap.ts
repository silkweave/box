// Seed the configured machine identity before human bootstrap; never rename an existing account.
import { ensureSchema, withRead } from '../warehouse/db.js'
import { readUser, upsertUser } from '../users/state.js'
import { agentIdentity, bindAgentIdentity, systemUserId } from '../box-config.js'

/** The machine account does not count as a human, even when configured as an admin. */
export async function hasHumanUsers(): Promise<boolean> {
  await ensureSchema()
  const rows = await withRead<{ n: number }>(`SELECT count(*) AS n FROM users WHERE id <> ?`, [systemUserId()])
  return Number(rows[0]?.n ?? 0) > 0
}

/** Name and role come from host config; other profile fields and credentials survive reboot. */
export async function ensureSystemPrincipal(): Promise<void> {
  await ensureSchema()
  const agent = agentIdentity()
  const existing = await readUser(agent.id)
  if (!existing && await hasHumanUsers()) {
    throw new Error('configured agent does not exist in this populated Box; restore its original agent.id before booting')
  }
  bindAgentIdentity()
  await upsertUser({ id: agent.id, first_name: agent.name, last_name: '', nickname: agent.id,
    role: agent.role, ...(existing ? {} : { sort: 99 }) })
}
