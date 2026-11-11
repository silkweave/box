import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, homedir, release, type } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { SessionEvent, SessionInfo } from '@workerdeck/protocol'
import { readJournal } from './builder-journal.js'
import { readTurns, type TurnRecord } from './builder-turns.js'
import { createRedactor, envFileValues, keysOnly, secretValues, type Redactor } from './redact.js'
import { createZip, type ZipEntry } from './zip.js'

/**
 * "Export session": one zip a field tester sends when a Builder session goes wrong. It holds what a
 * supporter needs to see what happened, and nothing of the Box's own data:
 *
 * - `manifest.json`: session, Box and tool versions, recipes ledger, application state
 * - `transcript.md` and `transcript.ndjson`: the conversation, tool calls and results (long values
 *   shortened), from WorkerDeck; `conversations/<n>.ndjson` for earlier conversations of the session
 * - `engine-transcript.jsonl`: the engine's own transcript (Claude or Codex), only when WorkerDeck no
 *   longer knows the session (it ended); transcript.md is then rendered from it
 * - `turns.ndjson`: HEAD, branch, `git status` and diff summary at the start and end of each turn
 * - `journal.ndjson`: supervisor, lifecycle, build and application events from the session's window
 * - `verification.json`: the last Wrap Up verification
 * - `config/box.json` and `config/box.local.keys.json` (key names only, never values)
 * - `box/UPSTREAM.md`: the Box's recorded source ancestry
 *
 * Every text goes through the redactor (known secret values from box.local.json and profile token
 * files, plus token patterns). Never included: the warehouse or chat stores, uploads, other
 * sessions, box.local.json values.
 */

const MAX_STRING = 8_000
const MAX_JOURNAL = 20_000
/** Journal entries from shortly before the session started, so its boot is visible. */
const JOURNAL_LEAD_MS = 10 * 60 * 1000

export interface ExportFile { name: string; bytes: number; description: string }
export interface SessionExport { fileName: string; files: ExportFile[]; zip: Buffer }

export interface ExportSources {
  root: string
  instanceDir: string
  sessionId: string
  /** The session as WorkerDeck knows it (live or parked); null once it ended. */
  info: SessionInfo | null
  /** When the Builder session started, from the Builder control record. */
  startedAt?: string | null
  /** The current conversation's events, oldest first; null when WorkerDeck no longer has them. */
  events: SessionEvent[] | null
  /** Earlier conversations of the session: `n` and their events. */
  conversations: Array<{ n: number; events: SessionEvent[] }>
  verification: unknown
  application: unknown
  /** The profile home of the session's Claude profile, for the ended-session fallback. */
  profileHome?: string | null
  /** Extra known secrets (profile MCP token files). */
  secrets?: string[]
  now?: Date
}

const readJson = (file: string): unknown => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function git(root: string, args: string[]): string | null {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

/** The package's exports hide package.json, so walk up from its resolved entry point. */
function workerdeckVersion(root: string): string | null {
  try {
    let dir = dirname(createRequire(join(root, 'apps/server/package.json')).resolve('@workerdeck/server'))
    for (let depth = 0; depth < 6; depth++, dir = dirname(dir)) {
      const pkg = readJson(join(dir, 'package.json')) as { name?: string; version?: string } | null
      if (pkg?.name === '@workerdeck/server') return pkg.version ?? null
    }
  } catch { /* not installed */ }
  return null
}

/** Long strings are cut so a transcript of large tool outputs stays readable and small. */
function shorten<T>(value: T): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return node.length > MAX_STRING ? `${node.slice(0, MAX_STRING)}… [${node.length - MAX_STRING} more characters]` : node
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]))
    return node
  }
  return walk(value) as T
}

/** Streaming deltas repeat the final messages token by token; the export keeps the messages. */
const kept = (event: SessionEvent): boolean => event.type !== 'stream_delta'

const ndjson = (values: unknown[]): string => values.map(value => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '')

type Block = { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean }
const blocks = (message: unknown): Block[] => {
  const content = (message as { content?: unknown } | null)?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content as Block[] : []
}
const resultText = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? `[${(part as { type?: string }).type ?? 'part'}]`).join('\n') : ''
const fence = (text: string): string => `\`\`\`\n${text.replace(/```/g, '` ` `')}\n\`\`\``
const clip = (text: string, max = 2_000): string => text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text

/** A readable transcript: who said what, which tools ran with what input, and what came back. */
export function transcriptMarkdown(events: SessionEvent[]): string {
  const out: string[] = []
  for (const event of events) {
    const at = new Date(event.ts).toISOString()
    if (event.type === 'user_message' && !event.parentToolUseId) {
      for (const block of blocks(event.message)) {
        if (block.type === 'text' && block.text) out.push(`### User · ${at}\n\n${block.text}`)
        if (block.type === 'tool_result') out.push(`**Result${block.is_error ? ' (error)' : ''}**\n\n${fence(clip(resultText(block.content)))}`)
      }
    } else if (event.type === 'assistant_message') {
      const sub = event.parentToolUseId ? ' (subagent)' : ''
      for (const block of blocks(event.message)) {
        if (block.type === 'text' && block.text) out.push(`### Assistant${sub} · ${at}\n\n${block.text}`)
        if (block.type === 'tool_use') out.push(`**Tool${sub}: ${block.name}**\n\n${fence(clip(JSON.stringify(block.input, null, 2)))}`)
      }
    } else if (event.type === 'user_message') {
      for (const block of blocks(event.message)) if (block.type === 'tool_result') out.push(`**Result${block.is_error ? ' (error)' : ''}**\n\n${fence(clip(resultText(block.content)))}`)
    } else if (event.type === 'turn_result') {
      out.push(`*Turn ended: ${event.subtype}, ${Math.round(event.durationMs / 1000)}s, ${event.numTurns} steps${event.errors?.length ? `, errors: ${event.errors.join('; ')}` : ''}*`)
    } else if (event.type === 'session_error') {
      out.push(`**Session error:** ${event.message}`)
    } else if (event.type === 'permission_requested') {
      out.push(`*Permission requested: ${(event.request as { toolName?: string }).toolName ?? 'tool'}*`)
    } else if (event.type === 'permission_mode_changed' || event.type === 'model_changed') {
      out.push(`*${event.type.replace(/_/g, ' ')}: ${JSON.stringify(event).slice(0, 200)}*`)
    } else if (event.type === 'conversation_reset' || event.type === 'context_compacted') {
      out.push(`*${event.type.replace(/_/g, ' ')}*`)
    }
  }
  return `${out.join('\n\n')}\n`
}

/** The engine's own transcript of a session WorkerDeck no longer knows (it ended). */
export interface EngineTranscript { engine: 'claude' | 'codex'; text: string }

const ENGINE_SESSION_ID = /^[A-Za-z0-9-]{8,64}$/

/** Claude keeps `<config>/projects/<cwd with non-alphanumerics as dashes>/<session>.jsonl`. */
function claudeTranscript(home: string | null | undefined, cwd: string, engineSessionId: string): string | null {
  const file = join(home || join(homedir(), '.claude'), 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${engineSessionId}.jsonl`)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** Codex keeps `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl` (or archived_sessions/). */
function codexTranscript(home: string | null | undefined, engineSessionId: string): string | null {
  const base = home || join(homedir(), '.codex')
  const suffix = `-${engineSessionId}.jsonl`
  for (const dir of ['sessions', 'archived_sessions']) {
    let names: string[]
    try { names = readdirSync(join(base, dir), { recursive: true, encoding: 'utf8' }) } catch { continue }
    const found = names.filter(name => basename(name).startsWith('rollout-') && name.endsWith(suffix)).sort().at(-1)
    if (found) return readFileSync(join(base, dir, found), 'utf8')
  }
  return null
}

export function engineTranscript(engine: string | null, home: string | null | undefined, cwd: string, engineSessionId: string | null): EngineTranscript | null {
  if (!engineSessionId || !ENGINE_SESSION_ID.test(engineSessionId)) return null
  if (engine === 'codex') {
    const text = codexTranscript(home, engineSessionId)
    return text === null ? null : { engine: 'codex', text }
  }
  const text = claudeTranscript(home, cwd, engineSessionId)
  return text === null ? null : { engine: 'claude', text }
}

const parseLines = (text: string): Array<Record<string, unknown>> => text.split('\n').filter(Boolean).flatMap(line => {
  try { const value = JSON.parse(line) as unknown; return value && typeof value === 'object' ? [value as Record<string, unknown>] : [] } catch { return [] }
})
const timeOf = (value: unknown): number => { const ms = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isNaN(ms) ? 0 : ms }
const asEvent = (value: Record<string, unknown>): SessionEvent => value as unknown as SessionEvent

/** Context Codex injects as user messages (AGENTS.md, environment, permissions), not typed by anyone. */
const injected = (text: string): boolean => /^\s*(<(environment_context|permissions instructions|user_instructions|collaboration_mode|skill_instructions)\b|# AGENTS\.md instructions)/.test(text)

/**
 * The engine transcript as the session events `transcriptMarkdown` reads, so an ended session still
 * gets a readable transcript.md. Only messages, tool calls, results and turn ends are kept.
 */
export function engineEvents(transcript: EngineTranscript): SessionEvent[] {
  const events: SessionEvent[] = []
  const lines = parseLines(transcript.text)
  if (transcript.engine === 'claude') {
    for (const line of lines) {
      if ((line.type !== 'user' && line.type !== 'assistant') || !line.message) continue
      events.push(asEvent({ type: `${line.type}_message`, ts: timeOf(line.timestamp), parentToolUseId: line.isSidechain ? 'sidechain' : null, message: line.message }))
    }
    return events
  }
  let started = 0
  let steps = 0
  for (const line of lines) {
    const ts = timeOf(line.timestamp)
    const payload = (line.payload ?? {}) as Record<string, unknown>
    if (line.type === 'event_msg') {
      if (payload.type === 'task_started') { started = ts; steps = 0 }
      else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
        const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : started ? ts - started : 0
        const subtype = payload.type === 'turn_aborted' ? `aborted (${String(payload.reason ?? 'unknown')})` : 'success'
        events.push(asEvent({ type: 'turn_result', ts, subtype, isError: payload.type === 'turn_aborted', durationMs, numTurns: steps }))
      } else if (payload.type === 'error' && typeof payload.message === 'string') {
        events.push(asEvent({ type: 'session_error', ts, message: payload.message }))
      }
      continue
    }
    if (line.type !== 'response_item') continue
    if (payload.type === 'compaction') events.push(asEvent({ type: 'context_compacted', ts }))
    else if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      const texts = (Array.isArray(payload.content) ? payload.content as Block[] : [])
        .filter(part => typeof part.text === 'string' && (payload.role === 'assistant' || !injected(part.text)))
        .map(part => ({ type: 'text', text: part.text }))
      if (texts.length) events.push(asEvent({ type: `${payload.role}_message`, ts, parentToolUseId: null, message: { role: payload.role, content: texts } }))
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      steps++
      let input: unknown = payload.type === 'function_call' ? payload.arguments : payload.input
      if (typeof input === 'string') { try { input = JSON.parse(input) } catch { /* free-form input stays text */ } }
      events.push(asEvent({ type: 'assistant_message', ts, parentToolUseId: null, message: { role: 'assistant', content: [{ type: 'tool_use', id: payload.call_id, name: payload.name, input }] } }))
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      events.push(asEvent({ type: 'user_message', ts, parentToolUseId: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: payload.call_id, content: payload.output }] } }))
    }
  }
  return events
}

function upstreamCore(text: string | null): string | null {
  if (!text) return null
  return /Latest core refresh: Stack commit `([0-9a-f]{40})`/.exec(text)?.[1] ?? /Stack commit\s+`([0-9a-f]{40})`/.exec(text)?.[1] ?? null
}

/** Every secret value this Box holds, for the redactor. */
export function knownSecrets(root: string, extra: string[] = []): string[] {
  const local = readJson(join(root, 'box.local.json'))
  const values = secretValues(local)
  const profiles = ((local as { workerdeck?: { profiles?: Array<{ mcpTokensPath?: string }> } } | null)?.workerdeck?.profiles ?? [])
  for (const profile of profiles) {
    if (typeof profile.mcpTokensPath !== 'string') continue
    try { values.push(...envFileValues(readFileSync(profile.mcpTokensPath, 'utf8'))) } catch { /* unreadable: nothing to redact from it */ }
  }
  return [...values, ...extra]
}

export function buildSessionExport(sources: ExportSources): SessionExport {
  const { root, instanceDir, sessionId, info } = sources
  const now = sources.now ?? new Date()
  const redactor: Redactor = createRedactor(knownSecrets(root, sources.secrets))
  const turns: TurnRecord[] = readTurns(instanceDir, sessionId)
  const lastTurnSession = turns.at(-1)?.session
  const engineSessionId = info?.sdkSessionId ?? lastTurnSession?.engineSessionId ?? null
  const started = sources.startedAt ? new Date(sources.startedAt) : info ? new Date(info.createdAt) : turns[0] ? new Date(turns[0].time) : new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const journal = readJournal(instanceDir, new Date(started.getTime() - JOURNAL_LEAD_MS)).slice(-MAX_JOURNAL)
  const boxJson = readJson(join(root, 'box.json')) as Record<string, unknown> | null
  const upstream = existsSync(join(root, 'docs/UPSTREAM.md')) ? readFileSync(join(root, 'docs/UPSTREAM.md'), 'utf8') : null
  const events = sources.events?.filter(kept) ?? null
  const engine = info?.engine ?? lastTurnSession?.engine ?? null
  const ended = events === null ? engineTranscript(engine, sources.profileHome, info?.cwd ?? root, engineSessionId) : null

  const entries: Array<ZipEntry & { description: string }> = []
  const add = (name: string, data: string, description: string): void => { entries.push({ name, data: redactor.text(data), modified: now, description }) }
  const clean = <T>(value: T): T => redactor.value(shorten(value))

  const manifest = {
    exportedAt: now.toISOString(),
    session: {
      id: sessionId,
      known: info !== null,
      status: info?.status ?? 'ended',
      engine: info?.engine ?? lastTurnSession?.engine ?? null,
      profile: info?.profile ?? lastTurnSession?.profile ?? null,
      model: info?.model ?? lastTurnSession?.model ?? null,
      permissionMode: info?.permissionMode ?? null,
      engineSessionId,
      startedAt: started.toISOString(),
      conversation: info?.conversation ?? null,
      numTurns: info?.numTurns ?? turns.filter(turn => turn.outcome !== 'started').length,
      totalCostUsd: info?.totalCostUsd ?? null,
      title: info?.title ?? null,
    },
    box: {
      head: git(root, ['rev-parse', 'HEAD']),
      branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: (git(root, ['status', '--porcelain=v1']) ?? '').length > 0,
      remote: redactor.text(git(root, ['remote', 'get-url', 'origin']) ?? '') || null,
      stackCore: upstreamCore(upstream),
      stackSource: (boxJson?.stack as { source?: unknown } | undefined)?.source ?? null,
      recipes: boxJson?.recipes ?? {},
    },
    versions: {
      bun: process.versions.bun ?? null,
      node: process.versions.node,
      workerdeck: workerdeckVersion(root),
      os: `${type()} ${release()} ${arch()}`,
    },
    application: sources.application,
    files: [] as ExportFile[],
  }

  add('README.md', [
    '# Builder session export',
    '',
    `Session ${sessionId}, exported ${now.toISOString()}.`,
    '',
    'Contents: manifest.json (versions, session, recipes), transcript.md (readable conversation),',
    'transcript.ndjson (WorkerDeck events) or, for an ended session, engine-transcript.jsonl (the',
    'Claude or Codex transcript), turns.ndjson (git state at the start and end of each turn), journal.ndjson',
    '(supervisor, build and application events from the session window), verification.json (last',
    'Wrap Up verification), config/ (box.json, and box.local.json key names without values),',
    'box/UPSTREAM.md (source ancestry).',
    '',
    'Known secrets and token patterns were replaced with [redacted]. Long tool outputs were shortened.',
    'Look it over before sending: anything you typed or a tool printed in the session is included.',
    '',
  ].join('\n'), 'What this export contains')
  if (events) {
    add('transcript.md', transcriptMarkdown(clean(events)), 'Readable conversation, tool calls and results')
    add('transcript.ndjson', ndjson(clean(events)), 'Session events from WorkerDeck')
  }
  for (const past of sources.conversations) add(`conversations/${past.n}.ndjson`, ndjson(clean(past.events.filter(kept))), `Earlier conversation ${past.n}`)
  if (ended) {
    const label = ended.engine === 'codex' ? 'Codex' : 'Claude'
    add('transcript.md', transcriptMarkdown(clean(engineEvents(ended))), `Readable conversation of the ended session, from the ${label} transcript`)
    const lines = ended.text.split('\n').filter(Boolean).map(line => { try { return JSON.stringify(clean(JSON.parse(line))) } catch { return JSON.stringify(clean(line)) } })
    add('engine-transcript.jsonl', `${lines.join('\n')}\n`, `${label} transcript of the ended session`)
  }
  add('turns.ndjson', ndjson(turns), 'Git state at the start and end of each turn')
  add('journal.ndjson', ndjson(clean(journal)), 'Supervisor, build and application events')
  add('verification.json', `${JSON.stringify(clean(sources.verification ?? null), null, 2)}\n`, 'Last Wrap Up verification')
  add('config/box.json', `${JSON.stringify(redactor.value(boxJson), null, 2)}\n`, 'Shared Box settings')
  add('config/box.local.keys.json', `${JSON.stringify(keysOnly(readJson(join(root, 'box.local.json'))), null, 2)}\n`, 'Local settings, key names only')
  if (upstream) add('box/UPSTREAM.md', upstream, 'Recorded source ancestry')

  manifest.files = entries.map(entry => ({ name: entry.name, bytes: Buffer.byteLength(entry.data as string), description: entry.description }))
  manifest.files.unshift({ name: 'manifest.json', bytes: 0, description: 'Versions, session and recipes' })
  const render = (): string => redactor.text(`${JSON.stringify(redactor.value(manifest), null, 2)}\n`)
  manifest.files[0]!.bytes = Buffer.byteLength(render())
  const manifestText = render()
  const zip = createZip([{ name: 'manifest.json', data: manifestText, modified: now }, ...entries])
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return { fileName: `builder-session-${stamp}-${sessionId.slice(0, 8)}.zip`, files: manifest.files, zip }
}
