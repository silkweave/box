// Re-print a user's CURRENT access token without rotating it. The non-destructive counterpart to
// `box auth token`: tokens are stored encrypted-at-rest (reversible) precisely so a lost token can
// be re-read instead of reset. Nothing breaks - the same token keeps working everywhere it is
// already pasted. Shell equivalent of the admin-only `UserInviteReveal` tRPC/MCP call and of
// Settings -> Users -> ... -> View access token. Needs AUTH_TOKEN_SECRET set.
//
//   box auth reveal <user-id>

import { ensureSchema, ensureSystemPrincipal, resolvePrincipalById, revealPrincipalToken } from '@silkweave/box-core'
import { appUrl } from '../src/auth/app-url.js'

async function main(): Promise<void> {
  const id = process.argv[2]
  if (!id) {
    console.error('usage: box auth reveal <user-id>')
    process.exit(1)
  }
  await ensureSchema()
  await ensureSystemPrincipal()
  const principal = await resolvePrincipalById(id)
  if (!principal) {
    console.error(`no user "${id}" (or they are revoked) - check Settings -> Users.`)
    process.exit(1)
  }
  const token = await revealPrincipalToken(id)
  if (!token) {
    console.error(`"${id}" has no active access token - mint the first one with:  box auth token ${id}`)
    process.exit(1)
  }
  console.log(`current access token for "${id}" (${principal.display}) - unchanged, still valid:\n`)
  console.log(`  ${token}\n`)
  console.log('This is the PERMANENT credential: the MCP/CLI bearer, and what the dashboard login')
  console.log(`box accepts at ${appUrl()}/. It does not expire.`)
  console.log('')
  console.log('Treat it like a password. Password manager, not a chat message, and never in a URL.')
  console.log(`To just SIGN SOMEONE IN, send a short-lived link instead:  box auth link ${id}`)
  console.log('')
  console.log('This did NOT rotate anything - existing logins and MCP connections keep working.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
