// The MCP clients people connected to their accounts (MCP sign-in, core mcp-auth.ts), from the
// shell: list them, revoke one, or revoke all of one person's. The same decisions as Connected apps
// in Settings (Profile, Users); the `mcp` recipe supplies them, so a Box without it says so.
//
//   box auth connections [<user-id>]
//   box auth connections revoke <grant-id>
//   box auth connections revoke-all <user-id>
//   box auth connections log [<user-id>]      the audit trail, newest first

import { asSystem, ensureAgentPrincipals, withDatabase, type McpSignIn } from '@silkweave/box-core'
import { SERVER_FEATURE_LIST } from '../src/generated/features.js'
import { commandError, commandHeader, commandLine, commandSuccess } from '../../../packages/cli/src/command-ui.js'

const USAGE = 'Usage: box auth connections [<user-id>] | revoke <grant-id> | revoke-all <user-id> | log [<user-id>]'
const LOG_LIMIT = 100
const ACTOR = 'cli'

function signIn(): McpSignIn | null {
  for (const f of SERVER_FEATURE_LIST) if (f.mcpAuth) return f.mcpAuth().signIn
  return null
}

const day = (iso: string | null): string => (iso ? iso.slice(0, 16).replace('T', ' ') : 'never')

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2)
  const s = signIn()
  if (!s) {
    commandError('MCP sign-in is not set up on this Box (the mcp recipe adds it).')
    process.exit(1)
  }
  await ensureAgentPrincipals()
  commandHeader('auth connections')
  if (first === 'revoke') {
    if (!second) return void (commandError(USAGE), process.exit(1))
    if (await s.revoke(second, { owner: null, actor: ACTOR })) commandSuccess(`Revoked ${second}. The app stops working at once.`)
    else return void (commandError(`No active connection "${second}".`), process.exit(1))
    return
  }
  if (first === 'revoke-all') {
    if (!second) return void (commandError(USAGE), process.exit(1))
    const n = await s.revokeAll(second, ACTOR)
    commandSuccess(`Revoked ${n} connection(s) of "${second}".`)
    return
  }
  if (first === 'log') {
    const events = await s.log(second ?? null, LOG_LIMIT)
    if (events.length === 0) {
      commandLine(second ? `No sign-in activity for "${second}".` : 'No sign-in activity.')
      return
    }
    for (const e of events) {
      const who = e.principalId ?? '-'
      const what = e.event === 'revoked' ? `revoked (${e.reason ?? '?'}${e.actor ? `, by ${e.actor}` : ''})` : e.event
      commandLine(`${day(e.at)}  ${what.padEnd(12)}  ${who}  ${e.clientId ?? ''}${e.grantId ? `  ${e.grantId}` : ''}${e.ip ? `  from ${e.ip}` : ''}`)
    }
    if (events.length === LOG_LIMIT) commandLine(`The newest ${LOG_LIMIT} entries.`, 'muted')
    return
  }
  if (first?.startsWith('-')) return void (commandError(USAGE), process.exit(1))
  const apps = await s.apps(first ?? null)
  commandLine(`MCP URL: ${s.url() ?? 'not offered at this address (server.dashboardUrl must be https)'}`, 'muted')
  if (apps.length === 0) {
    commandLine(first ? `"${first}" has no connected apps.` : 'No connected apps.')
    return
  }
  for (const a of apps) {
    const name = a.clientName ?? a.clientHost ?? 'Unnamed app'
    const source = a.clientKind === 'cimd' && a.clientHost ? a.clientHost : 'unverified'
    commandLine(`${a.grantId}  ${a.principalId}  ${name} (${source})`)
    commandLine(`${a.device ? `approved in ${a.device} · ` : ''}connected ${day(a.connectedAt)} · last used ${day(a.lastUsedAt)} · reconnect by ${a.expiresAt.slice(0, 10)}`, 'muted', 4)
  }
  commandLine(`Revoke one: box auth connections revoke <grant-id>`, 'muted')
}

// A CLI script: adopts the running Box's database (or owns it while it runs), as named system work.
asSystem('cli: auth connections', () => withDatabase(main))
  .then(() => process.exit(0))
  .catch((err) => {
    commandError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
