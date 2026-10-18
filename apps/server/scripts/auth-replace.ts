// Replace an agent with a new one, on a STOPPED Box after a backup (`box db backup`). The new agent
// takes over the old one's configuration: the system principal in box.json and its identity lock,
// or its agent file; its instructions, agent profiles and browser identity. The old agent is retired
// (its token stops) and stays as the author of its history. Rows that still name the old id are
// listed, so feature configuration such as an automation trigger's run_as can be moved by hand.
//
//   box auth replace <old-id> <new-id> [--name "Display Name"]

import { ensureSchema, replaceAgent } from '@silkweave/box-core'
import { commandError, commandHeader, commandLine, commandWarning } from '../../../packages/cli/src/command-ui.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const nameAt = args.indexOf('--name')
  const name = nameAt >= 0 ? args[nameAt + 1] : undefined
  if (nameAt >= 0 && !name) {
    commandError('--name needs a value')
    process.exit(1)
  }
  const [from, to] = args.filter((_, i) => nameAt < 0 || (i !== nameAt && i !== nameAt + 1))
  if (!from || !to) {
    commandError('Usage: box auth replace <old-id> <new-id> [--name "Display Name"]')
    process.exit(1)
  }
  await ensureSchema()
  const result = await replaceAgent({ from, to, name })
  commandHeader('auth replace')
  commandLine(`${to} replaces ${from}${result.system ? ' as the system principal' : ''}; ${from} is retired.`)
  for (const change of result.changed) commandLine(`  ${change}`, 'muted')
  if (result.references.length) {
    commandWarning(`Rows that still name ${from} (history stays theirs; move any configuration by hand):`)
    for (const ref of result.references) commandLine(`  ${ref}`, 'muted')
  } else {
    commandLine(`No warehouse rows name ${from}.`, 'muted')
  }
  commandLine(`Next: box auth token ${to} --quiet, then update every client that used ${from}'s token (mcp.token, MCP profiles).`, 'muted')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    commandError(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
