// The agent files (`data/config/agents/*.md`) that travel with a database restore point. The files
// are the agents (agents.ts); the users rows are derived from them at boot. A restore point carries
// the files as they were when its database snapshot was taken (`agents.json`), and a restore puts
// both back; boot reconciliation then brings any derived row in step before work is admitted.
//
// Also: the intent record of an agent replacement (`data/config/agent-replace.json`). A replacement
// changes several files and rows in sequence; while its record exists, boot, backups and restores
// refuse and name the re-run that completes it.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { agentsDir } from '../agents.js'
import { configPath } from '../io.js'
import { fsyncDir, writeDurable } from '../db/durable.js'

const FORMAT = 'box-agent-files/1'
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,62}\.md$/

export type AgentFiles = Record<string, string>

/** The regular `.md` files in `data/config/agents/` (symlinks and other files are not agent files). */
export function captureAgentFiles(): AgentFiles {
  return captureAgentFilesFrom(agentsDir())
}

/** The regular `.md` files in `dir` (a staged agents directory, or the live one). */
export function captureAgentFilesFrom(dir: string): AgentFiles {
  if (!existsSync(dir)) return {}
  const out: AgentFiles = {}
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) out[e.name] = readFileSync(join(dir, e.name), 'utf8')
  }
  return out
}

export function agentFilesText(files: AgentFiles): string {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  return `${JSON.stringify({ format: FORMAT, files: sorted }, null, 2)}\n`
}

/** Write `files` to `file` durably; returns the SHA-256 of what was written. */
export function writeAgentFiles(file: string, files: AgentFiles): string {
  const text = agentFilesText(files)
  writeDurable(file, text)
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The agent files in `file`, validated in full. Throws on anything that is not exactly a snapshot
 * this code wrote: the caller has not touched live state yet.
 */
export function readAgentFiles(file: string): AgentFiles {
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
export function stageAgentFiles(files: AgentFiles, id = randomUUID().slice(0, 8)): string {
  const live = agentsDir()
  const staged = join(dirname(live), `agents.restoring-${id}`)
  try {
    rmSync(staged, { recursive: true, force: true })
    mkdirSync(staged, { recursive: true })
    if (existsSync(live)) {
      for (const e of readdirSync(live, { withFileTypes: true })) {
        if (e.isFile() && !e.name.endsWith('.md')) copyFileSync(join(live, e.name), join(staged, e.name))
      }
    }
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staged, name), text, { mode: 0o644 })
    fsyncDir(staged)
    return staged
  } catch (error) {
    rmSync(staged, { recursive: true, force: true })
    throw new Error(`agent files could not be staged: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
}

/** Where the live agent directory is parked during a swap. */
export function parkedAgentsDir(id: string): string {
  return join(dirname(agentsDir()), `agents.pre-restore-${id}`)
}

// ---- Agent replacement intent ----

export interface ReplaceIntent { from: string; to: string; step: string; at: string; [extra: string]: unknown }

export function replaceIntentPath(): string {
  return configPath('agent-replace.json')
}

export function readReplaceIntent(): ReplaceIntent | null {
  const f = replaceIntentPath()
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8')) as ReplaceIntent }
  catch { return { from: '?', to: '?', step: 'unreadable', at: '?' } }
}

export function writeReplaceIntent(intent: Omit<ReplaceIntent, 'at'>): void {
  writeDurable(replaceIntentPath(), `${JSON.stringify({ ...intent, at: new Date().toISOString() })}\n`)
}

export function clearReplaceIntent(): void {
  rmSync(replaceIntentPath(), { force: true })
  fsyncDir(dirname(replaceIntentPath()))
}

/** Why agent state must not be used (boot, backup, restore), or null. */
export function interruptedAgentChange(): string | null {
  const intent = readReplaceIntent()
  if (!intent) return null
  return (
    `an agent replacement (${intent.from} -> ${intent.to}) was interrupted at step "${intent.step}". ` +
    `Complete it by running \`box auth replace ${intent.from} ${intent.to}\` again.`
  )
}
