// Mint a SHORT-LIVED, single-use sign-in link for an existing user.
//
//   box auth login <user-id> [--ttl 15]      # minutes, default 15, max 1440
//
// This is the normal way to get a person into a Box, and the only credential here that is safe to
// paste into a chat message or an agent transcript: it expires in minutes, it works exactly once,
// and it cannot be turned into an API token. Compare:
//
//   box auth login  <id>   short-lived sign-in link      -> send it to them
//   box auth reveal <id>   their PERMANENT access token  -> for their MCP config, password manager
//   box auth token  <id>   MINT/ROTATE that token        -> breaks every place the old one is set
//
// Works with no server running: it talks to the warehouse directly, like the other auth scripts.
// It never CREATES a user - that is `box auth token`, and only on a Box that has none yet.

import { ensureSchema, ensureSystemPrincipal, issueSigninLink, resolvePrincipalById } from '@silkweave/box-core'
import { signinLinkUrl } from '../src/auth/app-url.js'
import { commandError, commandHeader, commandLine, commandValue, offerBrowserOpen } from '../../../packages/cli/src/command-ui.js'

function parseTtlMinutes(argv: string[]): number | undefined {
  const at = argv.indexOf('--ttl')
  if (at < 0) return undefined
  const raw = argv[at + 1]
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 1440) {
    commandError(`--ttl must be a whole number of minutes between 1 and 1440 (got "${raw ?? ''}")`)
    process.exit(1)
  }
  return n
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const ttlMinutes = parseTtlMinutes(argv)
  const ttlAt = argv.indexOf('--ttl')
  const [id] = argv.filter((a, i) => !a.startsWith('--') && (ttlAt < 0 || i !== ttlAt + 1))
  if (!id) {
    commandError('Usage: box auth login <user-id> [--ttl <minutes>]')
    commandLine('Permanent token: box auth reveal <user-id>', 'muted')
    process.exit(1)
  }

  await ensureSchema()
  await ensureSystemPrincipal()
  const principal = await resolvePrincipalById(id)
  if (!principal) {
    commandError(`No active user "${id}". Check Settings -> Users.`)
    commandLine(`First user: box auth token ${id} --name "Full Name"`, 'muted')
    process.exit(1)
  }

  const { grant, claims } = await issueSigninLink(id, {
    ...(ttlMinutes !== undefined && { ttlMs: ttlMinutes * 60_000 }),
  })
  const url = signinLinkUrl(grant)
  commandHeader('auth login')
  commandLine(`Sign into your Box as ${principal.display}:`)
  commandValue(url)
  commandLine(`Single use · expires in ${Math.round((claims.exp - claims.iat) / 60_000)} minutes`, 'muted')
  commandLine('')
  await offerBrowserOpen(url)
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    commandError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
