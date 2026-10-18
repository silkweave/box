// A member's Work session: the sandbox cwd, the stamped grant and the in-process tool guard.
// docs/AUTH.md § Work sessions; the classification itself is core's work-access.ts.
//
// Two halves, at the two places the server touches a session create:
// - `applyWorkSessionPolicy` runs in the mount's gateCreate, where the signed-in principal is known.
//   For an admin it only strips a forged `meta.work`. For a member it reads the person's Work
//   settings, refuses a disabled Work (and any engine the guard cannot run on), points cwd at
//   their sandbox, and stamps the grant onto `meta.work`.
// - `workRunnerConfig` runs in workerdeck's buildRunnerConfig, after the worker's vet, which is the
//   only place host-only runner config (instructions, SDK hooks) can be set. It turns the stamped
//   grant into a priming text and a PreToolUse hook. The hook re-reads the user's settings on every
//   guarded call, so an admin's change (or a revocation) applies to the running session.
//
// `meta.work` is trustworthy because gateCreate deletes whatever the client sent before stamping
// its own, and the loopback ('host') callers never set one.

import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import type { CreateSessionRequest } from '@workerdeck/protocol'
import {
  fileToolPaths,
  readUser,
  repoRoot,
  workRoots,
  workSandboxDir,
  workToolDecision,
  type Principal,
  type User,
  type WorkAccess,
  type WorkFs,
} from '@silkweave/box-core'

/** The real filesystem, in the shape the classification takes. */
export const WORK_FS: WorkFs = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  realpath: (path) => realpathSync(path),
  listDirectories: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  },
}

/** What gateCreate stamps onto `meta.work` for a guarded session. */
export interface WorkGrant {
  user: string
  /** Canonical granted roots at session start; the hook re-derives them live. */
  roots: string[]
  /** Box MCP tools present (the "all data and modules" checkbox). */
  data: boolean
}

export class WorkSessionError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

/**
 * WorkerDeck's own peer server (`mcp__workerdeck__*`: peers, status, shells). The one MCP server
 * a guarded session keeps when "all data and modules" is off. Every other MCP tool comes from the
 * person's own profile config, where the Box's server carries whatever name they gave it
 * (`box`, `team-box`, ...), so the Box cannot tell its own tools from the rest by name: off means
 * no MCP tools apart from the peer server.
 */
export const PEER_MCP_TOOL_PREFIX = 'mcp__workerdeck__'

/** The only engine the guard runs on: the PreToolUse hook is a Claude Agent SDK option. */
export const GUARDED_ENGINE = 'claude'

export interface WorkPolicyDeps {
  readUser: (id: string) => Promise<User | null>
  fs: WorkFs
  sandboxDir: (userId: string) => string
  mkdir: (dir: string) => void
}

// Resolved per call, not at import: test doubles of @silkweave/box-core may not carry every export.
const defaultDeps = (): WorkPolicyDeps => ({
  readUser: (id) => readUser(id),
  fs: WORK_FS,
  sandboxDir: (id) => workSandboxDir(id),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
})

const metaOf = (body: Record<string, unknown>): Record<string, unknown> =>
  typeof body.meta === 'object' && body.meta !== null && !Array.isArray(body.meta) ? (body.meta as Record<string, unknown>) : {}

/** Whose Work sessions are guarded: people who are not admins. Agents keep their own rules. */
export const isGuardedPrincipal = (principal: Principal | null | undefined): principal is Principal =>
  !!principal && principal.role !== 'admin' && principal.kind !== 'agent'

/**
 * Session-create policy for Work. Mutates `body` in place (after applyBuilderSessionPolicy, which
 * pinned cwd to the checkout). Throws WorkSessionError for a refusal the mount answers with.
 */
export async function applyWorkSessionPolicy(
  body: Record<string, unknown>,
  principal: Principal | null,
  engine: string,
  deps: Partial<WorkPolicyDeps> = {},
): Promise<WorkGrant | null> {
  const d = { ...defaultDeps(), ...deps }
  const meta = { ...metaOf(body) }
  delete meta.work
  body.meta = meta
  if (!isGuardedPrincipal(principal)) return null
  // Fail closed: an engine without the hook would run a member unguarded in their sandbox.
  if (engine !== GUARDED_ENGINE) {
    throw new WorkSessionError(403, 'work_engine_unsupported', `Work sessions for members run on Claude only (this profile is ${engine})`)
  }
  const user = await d.readUser(principal.id)
  if (!user || user.status === 'revoked') throw new WorkSessionError(403, 'work_unavailable', 'Work is not available for this account')
  const access = user.work
  if (!access.enabled) throw new WorkSessionError(403, 'work_disabled', 'Work is turned off for your account; ask an administrator')
  // The sandbox is the working directory even when it is not granted: it is inside the instance
  // dir, so inside the worker's allowed cwd roots, and the guard decides what may be touched there.
  const sandbox = d.sandboxDir(principal.id)
  d.mkdir(sandbox)
  let roots: string[]
  try {
    roots = workRoots(access, sandbox, d.fs)
  } catch (error) {
    throw new WorkSessionError(403, 'work_folder_invalid', `a Work folder cannot be granted: ${error instanceof Error ? error.message : String(error)}`)
  }
  body.cwd = sandbox
  const grant: WorkGrant = { user: principal.id, roots, data: access.data }
  body.meta = { ...meta, work: grant }
  return grant
}

/** The grant a session carries, or null for an unguarded one. Shape-checked: meta is JSON from the wire. */
export function workGrantOf(meta: unknown): WorkGrant | null {
  if (typeof meta !== 'object' || meta === null) return null
  const w = (meta as Record<string, unknown>).work
  if (typeof w !== 'object' || w === null) return null
  const g = w as Record<string, unknown>
  if (typeof g.user !== 'string' || !Array.isArray(g.roots) || typeof g.data !== 'boolean') return null
  return { user: g.user, roots: g.roots.filter((r): r is string => typeof r === 'string'), data: g.data }
}

/** The priming text appended to the session's system prompt. */
export function workInstructions(grant: WorkGrant, cwd: string): string {
  const folders = grant.roots.length > 0 ? grant.roots.map((r) => `- ${r}`).join('\n') : '- (none: this session has no folder to work in)'
  return [
    'This is a Work session on a Silkweave Box. You act for a team member, not an administrator.',
    `Your working directory is the person's own sandbox: ${cwd}.`,
    'You may create, edit and run files only inside these folders:',
    folders,
    'The Box source checkout, its configuration and its git history are off limits: file tools outside the folders above are refused, and shell commands that name the checkout, data/config, walk up with "..", write git history, or run the box CLI are refused. Do not try to work around a refusal; tell the person what you could not do and why.',
    grant.data
      ? 'The Box tools (the MCP servers of this profile) are available for the team data and modules.'
      : 'MCP tools are not available in this session (the Box data and modules are turned off for it); work with files and the web only.',
  ].join('\n')
}

// --- the PreToolUse hook -------------------------------------------------------------------------

/** The slice of the Claude Agent SDK hook contract the guard uses (structural, so no SDK import here). */
interface PreToolUseInput {
  hook_event_name: string
  tool_name: string
  tool_input: unknown
}
type HookOutput = {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}
type HookCallback = (input: PreToolUseInput, toolUseId: string | undefined, options: { signal: AbortSignal }) => Promise<HookOutput>

const deny = (reason: string): HookOutput => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})

/** Tools the guard looks at: the shell, the file tools and every MCP tool but the peer server's. Everything else passes untouched. */
export const isGuardedTool = (toolName: string, cwd: string): boolean =>
  toolName === 'Bash' || (toolName.startsWith('mcp__') && !toolName.startsWith(PEER_MCP_TOOL_PREFIX)) || fileToolPaths(toolName, {}, cwd) !== null

export interface WorkGuardDeps {
  readUser: (id: string) => Promise<User | null>
  fs: WorkFs
  checkout: () => string
}

/**
 * One guard per session; `cwd` is the session's sandbox. Reads the user's live settings on every guarded call (one indexed row),
 * so a change in Settings > Users, or a revocation, takes effect on the next tool call. Fails
 * closed: a missing row, a read error or an ungrantable folder denies the call.
 */
export function createWorkToolGuard(grant: WorkGrant, cwd: string, deps: Partial<WorkGuardDeps> = {}): HookCallback {
  const d: WorkGuardDeps = { readUser: (id) => readUser(id), fs: WORK_FS, checkout: () => repoRoot(), ...deps }
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || !isGuardedTool(input.tool_name, cwd)) return {}
    let access: WorkAccess
    try {
      const user = await d.readUser(grant.user)
      if (!user || user.status === 'revoked') return deny('this account can no longer use Work')
      access = user.work
    } catch (error) {
      return deny(`Work settings could not be read (${error instanceof Error ? error.message : String(error)})`)
    }
    if (!access.enabled) return deny('Work has been turned off for this account; ask an administrator')
    if (input.tool_name.startsWith('mcp__')) {
      return access.data ? {} : deny('the Box data and modules (MCP tools) are turned off for this Work session')
    }
    let roots: string[]
    try {
      roots = workRoots(access, cwd, d.fs)
    } catch (error) {
      return deny(`a Work folder cannot be granted: ${error instanceof Error ? error.message : String(error)}`)
    }
    const decision = workToolDecision(input.tool_name, input.tool_input, { cwd, roots, checkout: d.checkout(), fs: d.fs })
    return decision.allow ? {} : deny(decision.reason)
  }
}

/** The host-only runner config a guarded session gets; an unguarded request is returned as is. */
export function workRunnerConfig<T extends CreateSessionRequest>(req: T, deps: Partial<WorkGuardDeps> = {}): T {
  const grant = workGrantOf(req.meta)
  if (!grant) return req
  const cwd = req.cwd ?? workSandboxDir(grant.user)
  const guard = createWorkToolGuard(grant, cwd, deps)
  return {
    ...req,
    instructions: workInstructions(grant, cwd),
    extraOptions: {
      hooks: { PreToolUse: [{ hooks: [guard] }] },
      additionalDirectories: grant.roots.filter((r) => r !== cwd),
    },
  }
}
