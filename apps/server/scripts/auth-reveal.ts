// Re-print a user's CURRENT access token without rotating it. The non-destructive counterpart to
// `box auth token`: tokens are stored encrypted-at-rest (reversible) precisely so a lost token can
// be re-read instead of reset. Nothing breaks - the same token keeps working everywhere it is
// already pasted. Shell equivalent of the admin-only `UserInviteReveal` tRPC/MCP call and of
// Settings -> Users -> ... -> View access token. Needs AUTH_TOKEN_SECRET set.
//
//   box auth reveal <user-id>

import { ensureSchema, ensureSystemPrincipal, resolvePrincipalById, revealPrincipalToken } from '@silkweave/box-core'
import { appUrl } from '../src/auth/app-url.js'
import { commandError, commandHeader, commandLine, commandValue, commandWarning } from '../../../packages/cli/src/command-ui.js'

async function main(): Promise<void> {
  const id = process.argv[2]
  if (!id) {
    commandError('Usage: box auth reveal <user-id>')
    process.exit(1)
  }
  await ensureSchema()
  await ensureSystemPrincipal()
  const principal = await resolvePrincipalById(id)
  if (!principal) {
    commandError(`No active user "${id}". Check Settings -> Users.`)
    process.exit(1)
  }
  const token = await revealPrincipalToken(id)
  if (!token) {
    commandError(`"${id}" has no access token. Create one with: box auth token ${id}`)
    process.exit(1)
  }
  commandHeader('auth reveal')
  commandLine(`Access token for ${principal.display}:`)
  commandValue(token)
  commandWarning('Permanent credential. Store it in a password manager; never put it in a URL.')
  commandLine(`Unchanged · clients stay connected · dashboard: ${appUrl()}/`, 'muted')
  commandLine(`Browser sign-in: box auth login ${id}`, 'muted')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    commandError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
