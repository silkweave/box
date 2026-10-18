// Mint (or ROTATE) the access token for a user and print it ONCE, and - on a Box that has no users
// yet - CREATE that first user. --create explicitly adds a user to a populated Box on the host.
// This is the whole first-run path (docs/core/AUTH.md § 2): a fresh Box is
// otherwise a closed loop, because the login screen needs a user and every way to make one sits
// behind that login.
//
// The rule is one sentence: **when the Box has no human users and <id> does not exist, create <id>
// as an admin and mint its token.** On a Box that already has people, creating another user requires
// --create and defaults to member unless --admin is explicit. There is no network bootstrap window: a
// process on the host writing to the warehouse, and the host was always the trust boundary.
//
// AUTH_TOKEN_SECRET need not be set: absent, the Box generates its own into
// box.local.json on first use (auth/secrets.ts).
//
// A user has exactly ONE access token. Minting a new one OVERWRITES the old one, which stops working
// instantly - everywhere it was pasted (MCP configs, scripts, un-used magic links). So this is a
// password RESET, not an "add a device". If the user already has a live token and just needs to see
// it again, use `box auth reveal <id>` - that re-prints the SAME token and breaks nothing. This
// script therefore refuses to rotate a live token unless you pass --rotate.
//
//   box auth token <user-id> [actor] [--create] [--rotate] [--admin] [--quiet] [--name "Full Name"]
//
//   --create  create a missing user even when humans already exist. Refuses existing IDs, including
//             revoked users, without changing their profile, role or credential.
//   --admin   promote an existing user to admin, then do the usual token step. The break-glass for
//             a Box whose admins are gone (the last one cannot be demoted, revoked or deleted
//             through the app, so this is for a genuinely broken row). Implied on an empty Box.
//   --quiet   create and mint, print NO token. For an agent running the bootstrap on someone's
//             behalf: the person then runs `box auth reveal <id>` in their own terminal. A token
//             in an agent transcript is how the 2026-08-20 exposure happened.
//   --name    the display name for a user this script creates. Defaults to the id.

import {
  ensureSchema,
  ensureAgentPrincipals,
  hasHumanUsers,
  issuePrincipalToken,
  resolvePrincipalById,
  revealPrincipalToken,
  setPrincipalRole,
  upsertUser,
  issueSigninLink,
  readUser,
} from '@silkweave/box-core'
import { appUrl, signinLinkUrl } from '../src/auth/app-url.js'
import { commandError, commandHeader, commandLine, commandSuccess, commandValue, commandWarning } from '../../../packages/cli/src/command-ui.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const rotate = argv.includes('--rotate') || argv.includes('--force')
  const quiet = argv.includes('--quiet')
  const create = argv.includes('--create')
  const nameAt = argv.indexOf('--name')
  const name = nameAt >= 0 ? argv[nameAt + 1] : undefined
  // `nameAt + 1` is only a value to skip when --name was actually passed; with nameAt === -1 it
  // would swallow argv[0], which is the user id.
  const positional = argv.filter((a, i) => !a.startsWith('--') && (nameAt < 0 || i !== nameAt + 1))
  const [id, actor] = positional
  if (!id) {
    commandError('Usage: box auth token <user-id> [actor] [--create] [--rotate] [--admin] [--quiet] [--name "Full Name"]')
    commandLine('Existing token: box auth reveal <user-id>', 'muted')
    process.exit(1)
  }
  if (nameAt >= 0 && (!name?.trim() || name.startsWith('--'))) {
    throw new Error('--name requires a nonempty display name')
  }
  await ensureSchema()
  // The machine account every Box needs (scheduler attribution, the agent's seat):
  // its name and role are chosen on the host in box.json.
  await ensureAgentPrincipals()

  // Principal resolution deliberately hides revoked rows. Creation must check the directory so
  // --create never rewrites or reactivates an existing identity by mistake.
  if (create && await readUser(id)) throw new Error(`user "${id}" already exists; --create only accepts a new user id`)
  let principal = await resolvePrincipalById(id)
  let promote = argv.includes('--admin')
  if (!principal) {
    const populated = await hasHumanUsers()
    if (populated && !create) {
      console.error(`no user "${id}" - ask an admin to add them (Settings -> Users, or the user-upsert MCP tool).`)
      console.error('To explicitly create a new user on this host, pass --create (member by default; --admin for an admin).')
      process.exit(1)
    }
    // Creating as a member and promoting separately keeps ONE place where a role is
    // written with the refusals attached (setPrincipalRole), rather than two.
    const [first, ...rest] = (name ?? '').trim().split(/\s+/).filter(Boolean)
    await upsertUser({ id, nickname: id, first_name: first ?? id, last_name: rest.join(' ') })
    if (!populated) promote = true
    principal = (await resolvePrincipalById(id))!
    commandSuccess(populated ? `Created "${id}" as ${promote ? 'admin' : 'member'}` : `Created first user "${id}" as admin`)
  }
  if (promote && principal.role !== 'admin') {
    await setPrincipalRole(id, 'admin')
    commandSuccess(`"${id}" is now an admin`)
  }

  // Guard the common footgun: someone who just lost their token mints a new one and silently kills
  // every MCP connection and bookmarked magic link that carried the old one.
  if (!rotate && (await revealPrincipalToken(id))) {
    commandError(`"${id}" already has an active access token.`)
    commandLine(`Show it:    box auth reveal ${id}`, 'muted')
    commandLine(`Replace it: box auth token ${id} --rotate`, 'muted')
    commandWarning('Replacing it disconnects every client using the current token.')
    process.exit(1)
  }

  const token = await issuePrincipalToken(id, actor)
  const verb = rotate ? 'rotated' : 'minted'
  commandHeader('auth token')
  if (quiet) {
    // --quiet exists so an agent can mint on someone's behalf without the permanent token landing in
    // a transcript (that is how the 2026-08-20 exposure happened). It now prints a SIGN-IN LINK
    // instead of nothing: short-lived and single-use, so it is safe there, and the person can
    // actually get in without a second round trip.
    commandSuccess(`Access token ${verb} for ${principal.display}; the token itself is not printed.`)
    if (principal.kind === 'agent') return
    const { grant, claims } = await issueSigninLink(id)
    commandLine('Sign in once:', 'muted')
    commandValue(signinLinkUrl(grant))
    commandLine(`Expires ${new Date(claims.exp).toISOString()}`, 'muted')
    commandLine(`MCP token: box auth reveal ${id}`, 'muted')
    return
  }
  commandSuccess(`Access token ${verb} for ${principal.display}`)
  commandValue(token)
  commandWarning(`Save this permanent credential in a password manager. Show it later with: box auth reveal ${id}`)
  // A fresh Box's first act should not be "paste a 32-character secret into a browser". Mint the
  // link here so the very first sign-in is a click, and the token can go straight to a password
  // manager without ever being retyped.
  if (principal.kind === 'agent') return
  const { grant } = await issueSigninLink(id)
  commandLine('Sign in once:', 'muted')
  commandValue(signinLinkUrl(grant))
  commandLine(`Or paste the token at ${appUrl()}/ · later: box auth login ${id}`, 'muted')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    commandError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
