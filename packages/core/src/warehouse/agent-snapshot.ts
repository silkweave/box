// The agent files (`data/config/agents/*.md`) that travel with a warehouse restore point. The users
// rows of the Box's agents and the files that say which agents exist belong together, so every
// restore point the machine writes carries `<name>.agents.json` beside `<name>.db`, and a restore
// puts both back or neither.
//
// The sidecar has a format marker, so a restore can tell a valid snapshot (an empty one included)
// from damage. A restore point WITHOUT a sidecar is either from before agent files were backed up or
// an interrupted backup; the two look the same, so restoring one needs an explicit acknowledgement
// (backup.ts `keepAgentFiles`). Seeds are the owner's fixtures and keep the live files by default.
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { agentsDir } from '../agents.js'
import { agentsSnapshotPath } from './restore-points.js'

const FORMAT = 'box-agent-files/1'
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,62}\.md$/

export type AgentFiles = Record<string, string>

/** The regular `.md` files in `data/config/agents/` (symlinks and other files are not agent files). */
export function captureAgentFiles(): AgentFiles {
  const dir = agentsDir()
  if (!existsSync(dir)) return {}
  const out: AgentFiles = {}
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) out[e.name] = readFileSync(join(dir, e.name), 'utf8')
  }
  return out
}

/** Write `files` as the sidecar of restore point `dbPath`, atomically (temp file, then rename). */
export function writeAgentsSnapshot(dbPath: string, files: AgentFiles = captureAgentFiles()): string {
  const file = agentsSnapshotPath(dbPath)
  const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`
  try {
    writeFileSync(tmp, `${JSON.stringify({ format: FORMAT, files }, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  return file
}

/**
 * The agent files of restore point `dbPath`, validated in full, or null when it has no sidecar.
 * Throws on anything that is not exactly a snapshot this code wrote: the caller has not touched
 * live state yet.
 */
export function readAgentsSnapshot(dbPath: string): AgentFiles | null {
  const file = agentsSnapshotPath(dbPath)
  if (!existsSync(file)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${basename(file)} is not valid JSON: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isRecord(raw) || raw['format'] !== FORMAT || !isRecord(raw['files']) || Object.keys(raw).length !== 2) {
    throw new Error(`${basename(file)} is not an agent-files snapshot (${FORMAT})`)
  }
  const files = raw['files']
  for (const [name, text] of Object.entries(files)) {
    if (!FILE_NAME.test(name) || typeof text !== 'string') throw new Error(`${basename(file)}: ${JSON.stringify(name)} is not an agent file`)
  }
  return files as AgentFiles
}

/**
 * Build the restored `data/config/agents/` beside the live one, before anything live changes: the
 * snapshot's `.md` files plus the live directory's other regular files (left alone by a restore).
 */
export function stageAgentFiles(files: AgentFiles): string {
  const live = agentsDir()
  const staged = join(dirname(live), `agents.restoring-${randomUUID().slice(0, 8)}`)
  try {
    mkdirSync(staged, { recursive: true })
    if (existsSync(live)) {
      for (const e of readdirSync(live, { withFileTypes: true })) {
        if (e.isFile() && !e.name.endsWith('.md')) copyFileSync(join(live, e.name), join(staged, e.name))
      }
    }
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staged, name), text)
    return staged
  } catch (error) {
    rmSync(staged, { recursive: true, force: true })
    throw new Error(`agent files could not be staged: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
}

export interface AgentFilesSwap {
  /** Put the previous directory back (the database swap failed) and clear the marker. */
  undo(): void
  /** Both halves are in place: clear the marker, then drop the previous directory. Never throws: a
   *  directory that cannot be removed is left behind and returned for the summary. */
  commit(): string | null
}

/** Present only while a restore has swapped the agent files but not yet the database. */
const markerPath = (): string => join(dirname(agentsDir()), 'agents.restore-in-progress.json')

/**
 * Why this Box must not boot, or null: a restore that swapped the agent files and died before
 * swapping the database leaves its marker, and the files no longer match the warehouse. Boot
 * reconciliation would otherwise retire or change agents against that mixed state.
 */
export function interruptedAgentRestore(): string | null {
  const marker = markerPath()
  if (!existsSync(marker)) return null
  let detail = ''
  try {
    const m = JSON.parse(readFileSync(marker, 'utf8')) as { restorePoint?: string; previous?: string | null }
    detail = ` (restoring ${m.restorePoint ?? '?'}; the previous agent files are in ${m.previous ? basename(m.previous) : 'no directory'})`
  } catch {
    // An unreadable marker still means the restore did not finish.
  }
  return (
    `a warehouse restore was interrupted after swapping data/config/agents/${detail}. ` +
    `Run the restore again (box db restore <name>), or put the previous agent files back, then delete ${basename(marker)} in data/config/`
  )
}

/**
 * Replace `data/config/agents/` with a staged directory: two renames in one filesystem, under a
 * durable marker naming the restore point. A failure of the second rename puts the first back. A
 * process that dies before `commit` leaves the marker, and boot refuses until an operator resolves
 * it (`interruptedAgentRestore`).
 */
export function swapAgentFiles(staged: string, restorePoint: string): AgentFilesSwap {
  const live = agentsDir()
  const marker = markerPath()
  const previous = join(dirname(live), `agents.pre-restore-${randomUUID().slice(0, 8)}`)
  const hadLive = existsSync(live) && lstatSync(live).isDirectory()
  writeFileSync(marker, `${JSON.stringify({ restorePoint, previous: hadLive ? previous : null, at: new Date().toISOString() })}\n`)
  try {
    if (hadLive) renameSync(live, previous)
    try {
      renameSync(staged, live)
    } catch (error) {
      if (hadLive) renameSync(previous, live)
      throw error
    }
  } catch (error) {
    rmSync(marker, { force: true })
    throw error
  }
  return {
    undo() {
      rmSync(live, { recursive: true, force: true })
      if (hadLive) renameSync(previous, live)
      rmSync(marker, { force: true })
    },
    commit() {
      rmSync(marker, { force: true })
      if (!hadLive) return null
      try {
        rmSync(previous, { recursive: true, force: true })
        return null
      } catch {
        return previous
      }
    },
  }
}
