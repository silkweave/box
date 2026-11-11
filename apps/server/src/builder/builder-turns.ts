import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * What the checkout looked like when each Builder turn started (outcome `started`) and ended: HEAD, branch, `git status` and the
 * diff summary against HEAD. One line per turn in `data/builder/turns/<session>.ndjson`, read by the
 * session export so a supporter can see which turn changed what. Paths and counts only, never file
 * contents. Each line also names the engine session, so an ended session (which WorkerDeck no
 * longer knows) can still be exported from the engine's own transcript. Files older than 30 days
 * are removed when a new one starts.
 */
export interface TurnSession {
  engine: string | null
  profile: string | null
  model: string | null
  engineSessionId: string | null
}

export interface TurnRecord {
  time: string
  seq: number
  outcome: string
  durationMs: number
  costUsd: number | null
  head: string | null
  branch: string | null
  status: string[]
  statusTruncated: boolean
  diffStat: string[]
  session: TurnSession
}

const MAX_STATUS = 200
const MAX_DIFFSTAT = 100

const turnsDir = (instanceDir: string): string => join(instanceDir, 'builder', 'turns')
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
export const turnsPath = (instanceDir: string, sessionId: string): string => {
  if (!SESSION_ID.test(sessionId)) throw new Error('Invalid Builder session id')
  return join(turnsDir(instanceDir), `${sessionId}.ndjson`)
}

async function git(root: string, args: string[]): Promise<string | null> {
  try { return (await run('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout }
  catch { return null }
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function prune(instanceDir: string, keep: string): void {
  const dir = turnsDir(instanceDir)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    if (file !== keep && Date.now() - statSync(file).mtimeMs > MAX_AGE_MS) rmSync(file, { force: true })
  }
}

export async function recordTurn(root: string, instanceDir: string, sessionId: string, turn: { seq: number; subtype: string; durationMs: number; totalCostUsd?: number }, session: TurnSession): Promise<TurnRecord> {
  const [head, branch, status, diffStat] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    git(root, ['diff', '--stat=120', 'HEAD']),
  ])
  const statusLines = (status ?? '').split('\n').filter(Boolean)
  const record: TurnRecord = {
    time: new Date().toISOString(),
    seq: turn.seq,
    outcome: turn.subtype,
    durationMs: turn.durationMs,
    costUsd: typeof turn.totalCostUsd === 'number' ? turn.totalCostUsd : null,
    head: head?.trim() || null,
    branch: branch?.trim() || null,
    status: statusLines.slice(0, MAX_STATUS),
    statusTruncated: statusLines.length > MAX_STATUS,
    // The summary line is last; keep it when the per-file lines are cut.
    diffStat: (() => {
      const lines = (diffStat ?? '').split('\n').filter(Boolean)
      return lines.length > MAX_DIFFSTAT ? [...lines.slice(0, MAX_DIFFSTAT - 1), '…', lines.at(-1)!] : lines
    })(),
    session,
  }
  const file = turnsPath(instanceDir, sessionId)
  mkdirSync(turnsDir(instanceDir), { recursive: true, mode: 0o700 })
  if (!existsSync(file)) prune(instanceDir, file)
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  return record
}

export function readTurns(instanceDir: string, sessionId: string): TurnRecord[] {
  const file = turnsPath(instanceDir, sessionId)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').flatMap(line => {
    if (!line) return []
    try { return [JSON.parse(line) as TurnRecord] } catch { return [] }
  })
}

/** Builder sessions with a turn record, newest first. */
export function recordedSessions(instanceDir: string): Array<{ id: string; updatedAt: string }> {
  const dir = turnsDir(instanceDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith('.ndjson')).map(name => ({
    id: name.slice(0, -'.ndjson'.length),
    updatedAt: statSync(join(dir, name)).mtime.toISOString(),
  })).filter(entry => SESSION_ID.test(entry.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
