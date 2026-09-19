// Mint a SHORT-LIVED, single-use sign-in link for an existing user.
//
//   pnpm auth:link <user-id> [--ttl 15]      # minutes, default 15, max 1440
//
// This is the normal way to get a person into a Box, and the only credential here that is safe to
// paste into a chat message or an agent transcript: it expires in minutes, it works exactly once,
// and it cannot be turned into an API token. Compare:
//
//   pnpm auth:link   <id>   short-lived sign-in link      -> send it to them
//   pnpm auth:reveal <id>   their PERMANENT access token  -> for their MCP config, password manager
//   pnpm auth:token  <id>   MINT/ROTATE that token        -> breaks every place the old one is set
//
// Works with no server running: it talks to the warehouse directly, like the other auth scripts.
// It never CREATES a user - that is `pnpm auth:token`, and only on a Box that has none yet.

import { ensureSchema, ensureSystemPrincipal, issueSigninLink, resolvePrincipalById } from '@silkweave/box-core'
import { signinLinkUrl } from '../src/auth/app-url.js'

function parseTtlMinutes(argv: string[]): number | undefined {
  const at = argv.indexOf('--ttl')
  if (at < 0) return undefined
  const raw = argv[at + 1]
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 1440) {
    console.error(`--ttl must be a whole number of minutes between 1 and 1440 (got "${raw ?? ''}")`)
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
    console.error('usage: pnpm auth:link <user-id> [--ttl <minutes>]')
    console.error('       pnpm auth:reveal <user-id>    # their permanent token, for MCP setup')
    process.exit(1)
  }

  await ensureSchema()
  await ensureSystemPrincipal()
  const principal = await resolvePrincipalById(id)
  if (!principal) {
    console.error(`no user "${id}" (or they are revoked) - check Settings -> Users.`)
    console.error(`On a Box with no users yet, create the first one with:  pnpm auth:token ${id} --name "Full Name"`)
    process.exit(1)
  }

  const { grant, claims } = await issueSigninLink(id, {
    ...(ttlMinutes !== undefined && { ttlMs: ttlMinutes * 60_000 }),
  })
  const minutes = Math.round((claims.exp - claims.iat) / 60_000)

  console.log(`sign-in link for "${id}" (${principal.display}):\n`)
  console.log(`  ${signinLinkUrl(grant)}\n`)
  console.log(`Expires in ${minutes} minutes (${new Date(claims.exp).toISOString()}), and works ONCE.`)
  console.log('Safe to send - it carries no permanent credential. Need another? Just run this again.')
  console.log('')
  console.log('Note: signing in with a link invalidates any OLDER unused links for this person.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
