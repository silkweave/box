import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { repoRoot } from './repo.ts'
import { commandError, commandHeader, commandLine, commandSuccess } from './command-ui.ts'

// box builder export [--session <id>] [--out <file>]: the Builder session export (docs/BUILDER.md),
// fetched over the supervisor's owner-only local socket and written as one zip.
const args = process.argv.slice(2)
const value = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  if (at < 0) return undefined
  const next = args[at + 1]
  if (!next || next.startsWith('--')) { commandError(`${flag} needs a value`); process.exit(1) }
  return next
}
const unknown = args.filter((arg, i) => arg.startsWith('--') ? !['--session', '--out'].includes(arg) : !['--session', '--out'].includes(args[i - 1] ?? ''))
if (unknown.length) { commandError(`Unexpected argument: ${unknown[0]}. Expected: box builder export [--session <id>] [--out <file>]`); process.exit(1) }
const session = value('--session')
const out = value('--out')

const socketPath = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')
const path = `/session-export${session ? `?session=${encodeURIComponent(session)}` : ''}`
const req = request({ socketPath, method: 'GET', path }, res => {
  const chunks: Buffer[] = []
  res.on('data', chunk => chunks.push(chunk as Buffer))
  res.on('end', () => {
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message?: string; fileName?: string; files?: Array<{ name: string; bytes: number; description: string }>; zip?: string }
      if (res.statusCode !== 200 || !result.zip || !result.fileName) { commandError(result.message ?? 'Session export failed'); process.exitCode = 1; return }
      const target = resolve(process.env.BOX_INVOKED_FROM ?? process.cwd(), out ?? result.fileName)
      writeFileSync(target, Buffer.from(result.zip, 'base64'), { mode: 0o600 })
      commandHeader('builder export')
      for (const file of result.files ?? []) commandLine(`${file.name.padEnd(28)} ${String(file.bytes).padStart(9)} B  ${file.description}`, 'muted')
      commandSuccess(`Wrote ${target}`)
      commandLine('Look it over before sending: anything typed or printed in the session is included.', 'muted')
    } catch { commandError('Invalid response from Builder supervisor'); process.exitCode = 1 }
  })
})
req.on('error', () => {
  commandError('Cannot reach the local Builder supervisor. Start box dev or box start first.')
  process.exitCode = 1
})
req.end()
