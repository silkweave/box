import { useEffect, useState } from 'react'
import { WorkerDeckClient } from '@workerdeck/client'
import type { PermissionMode, SessionInfo } from '@workerdeck/protocol'
import { getActiveUserId } from './useActiveUser.ts'
import { readStored, writeStored } from './usePersistedState.ts'
import { appKey } from './storage.ts'

// Module-level agent store (docs/SERVER.md §3-§5), in the style of useActiveUser: the
// sidebar, the TopBar toggle, and the GenerateButton "Run now" action all converge on this
// singleton. The browser only ever talks to the Nest origin - REST at /agent/v1 and the derived
// same-origin WS both ride the authenticated /agent reverse proxy (cookies flow automatically; the
// x-box-csrf header covers cookie-authed mutations).

/**
 * The `meta.app` every session this Box creates carries, and the filter the sidebar's session list
 * and the active-session check use. MIRRORED from `AGENT_SESSION_APP` in
 * packages/core/src/agent-session.ts - apps/web does not depend on @silkweave/box-core, so the
 * value is duplicated here on purpose (the same arrangement packages/cli has with DEFAULT_PORT). The
 * two must stay in step: a mismatch makes the sidebar list nothing and the orphan sweep sweep
 * nothing, both silently.
 */
const AGENT_SESSION_APP = 'box'

const OPEN_KEY = appKey('agent', 'open')
const ENGINE_KEY = appKey('agent', 'engine')
const SESSION_KEY = appKey('agent', 'sessionId')
const WIDTH_KEY = appKey('agent', 'width')
const FULLSCREEN_KEY = appKey('agent', 'fullscreen')

/** Worker statuses after which a session no longer counts as "the active agent". */
const TERMINAL_STATUS = new Set<SessionInfo['status']>(['failed', 'closed'])

/** One engine this user may start a session on, with the profile it resolves to. */
export interface AgentEngine {
  id: string
  profile: string
}

export interface AgentConfig {
  enabled: boolean
  cwd: string
  /** null = let the worker's profile default decide (the normal case). */
  permissionMode: string | null
  model: string | null
  user: { id: string; display: string } | null
  /** The default engine's profile (server-resolved); null = unmapped. */
  profile: string | null
  /** This deployment pins sessions to per-user profiles - an unmapped user cannot start one. */
  profileRequired: boolean
  /** Engines this user is mapped for, default first. Empty = unmapped (or transition mode). */
  engines: AgentEngine[]
  /** The engine used when none is named. */
  defaultEngine: string
}

export interface AgentState {
  open: boolean
  /** Panel width in px (drag the left edge); null = the default `w-104`. Ignored while fullscreen. */
  width: number | null
  /** The panel claims the whole framed canvas below the top bar (VS Code's maximized-panel move). */
  fullscreen: boolean
  /** null until the first /api/agent/config fetch resolves ({enabled:false} on any failure). */
  config: AgentConfig | null
  /**
   * Which engine the NEXT session starts on. Sticky per browser, because it is a working
   * preference, not a property of the account - and it is deliberately not read off the live
   * session: switching the picker while attached should stage the next start, not relabel the
   * running one.
   */
  engine: string | null
  sessionId: string | undefined
  /** Last-known registry snapshot for the attached session (status dot); live state is in the panel. */
  session: SessionInfo | undefined
  /** A takeover decision is pending: another live session owns this user's one-agent slot. */
  conflict: { command: string | undefined; session: SessionInfo } | null
  /** The feature is enabled but the worker could not be reached. */
  unavailable: boolean
  starting: boolean
  /** Why the last start attempt failed, for the panel's empty state. */
  error: string | null
}

let state: AgentState = {
  open: readStored(OPEN_KEY, false, (v) => typeof v === 'boolean'),
  width: readStored<number | null>(WIDTH_KEY, null, (v) => v === null || typeof v === 'number'),
  fullscreen: readStored(FULLSCREEN_KEY, false, (v) => typeof v === 'boolean'),
  config: null,
  engine: readStored<string | null>(ENGINE_KEY, null, (v) => v === null || typeof v === 'string'),
  sessionId: undefined,
  session: undefined,
  conflict: null,
  unavailable: false,
  starting: false,
  error: null,
}

const listeners = new Set<() => void>()
const update = (patch: Partial<AgentState>): void => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const wsOrigin = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

export const agentClient = new WorkerDeckClient({
  baseUrl: '/agent/v1',
  headers: { 'x-box-csrf': '1' },
  // The default WS derivation rewrites an http(s) base; our base is origin-relative, so build the
  // same-origin URL explicitly (the proxy upgrades /agent/* to the worker).
  buildWsUrl: (sessionId, afterSeq) =>
    `${wsOrigin()}/agent/v1/sessions/${encodeURIComponent(sessionId)}/ws?afterSeq=${afterSeq}`,
})

let configPromise: Promise<AgentConfig> | null = null

/** Fetch (once) the server-owned session policy: enabled flag, cwd, defaults, principal. */
export function loadAgentConfig(): Promise<AgentConfig> {
  configPromise ??= fetch('/api/agent/config', { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`config ${res.status}`)
      return (await res.json()) as AgentConfig
    })
    .catch(
      (): AgentConfig => ({
        enabled: false,
        cwd: '',
        permissionMode: null,
        model: null,
        user: null,
        profile: null,
        profileRequired: false,
        engines: [],
        defaultEngine: 'codex',
      }),
    )
    .then((config) => {
      // A stored engine the account is no longer mapped for (someone's codex profile went away,
      // or the picker was set on another deployment) must not become a 403 on every start.
      const stored = state.engine
      const valid = stored && config.engines.some((e) => e.id === stored)
      update({ config, engine: valid ? stored : (config.defaultEngine ?? null) })
      return config
    })
  return configPromise
}

/** The identity sessions are owned by: the signed-in principal, else the localStorage picker. */
const agentUserId = (): string | undefined => state.config?.user?.id ?? getActiveUserId() ?? undefined

/**
 * This deployment runs each user's agent under their own Claude profile, but this user has none -
 * the proxy will refuse to start a session (403 `agent_profile_unmapped`) rather than run them on
 * someone else's config dir. Surfaced as a distinct empty state, not a failed start.
 *
 * Only claimed for an AUTHENTICATED identity: in transition mode the server has no principal to
 * resolve against (identity is the localStorage picker, which only the proxy sees on create), so
 * the start is attempted and the proxy stays the authority.
 */
export const agentProfileMissing = (config: AgentConfig | null): boolean =>
  config?.profileRequired === true && config.user !== null && config.engines.length === 0

/**
 * Re-attach flow: the worker registry is the source of truth for "my active agent". Lists the
 * user's non-terminal Box sessions and attaches the newest (all windows converge on it).
 */
export async function refreshAgentSession(): Promise<SessionInfo | undefined> {
  const config = await loadAgentConfig()
  if (!config.enabled) return undefined
  try {
    const sessions = await agentClient.listSessions()
    const uid = agentUserId()
    // No identity (transition mode, no picker chosen): only claim UNOWNED sessions - never attach
    // an anonymous window to a session another user's identity stamped.
    const active = sessions
      // Builder sessions have their own workspace and transcript. Never attach the everyday
      // assistant sidebar to one, even though both products use the same WorkerDeck mount.
      .filter(
        (s) =>
          s.meta?.app === AGENT_SESSION_APP &&
          s.meta?.kind !== 'builder' &&
          s.meta?.user === uid &&
          !TERMINAL_STATUS.has(s.status),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    update({ unavailable: false, sessionId: active?.id, session: active })
    writeStored(SESSION_KEY, active?.id ?? null)
    return active
  } catch {
    update({ unavailable: true })
    return undefined
  }
}

async function createSession(prompt: string | undefined): Promise<void> {
  const config = await loadAgentConfig()
  if (!config.enabled) return
  update({ starting: true, error: null })
  try {
    const uid = agentUserId()
    // No `profile` here on purpose: the /agent proxy resolves it from the authenticated identity
    // and stamps it onto the body (like meta.user) - the browser never names a config dir.
    const session = await agentClient.createSession({
      cwd: config.cwd,
      prompt,
      ...(config.permissionMode ? { permissionMode: config.permissionMode as PermissionMode } : {}),
      model: config.model ?? undefined,
      // The ENGINE is named; the profile is not. The proxy maps (identity, engine) → profile name
      // and stamps it. Model stays unset so the worker's own per-profile default applies - which
      // is what puts a codex session on gpt-5.6-luna without the Box hard-coding a model id.
      ...(state.engine ? { engine: state.engine } : {}),
      // No `settingSources`: WorkerDeck reserves it to operators (it loads hooks and settings from
      // the host), and a browser user reaches the worker as a scoped non-operator, so naming it
      // fails the create with a 403-style refusal.
      questionBehavior: 'ask',
      meta: { app: AGENT_SESSION_APP, ...(uid ? { user: uid } : {}) },
    })
    writeStored(SESSION_KEY, session.id)
    update({ starting: false, unavailable: false, sessionId: session.id, session, conflict: null, error: null })
  } catch (err) {
    // The proxy's one-agent gate answers 409 {error:'agent_active'} on a race - surface takeover.
    if (err instanceof Error && err.message === 'agent_active') {
      const active = await refreshAgentSession()
      update({ starting: false, ...(active
        ? { conflict: { command: prompt, session: active } }
        : { error: 'Your Builder session is active. Continue or end it in Builder before starting an assistant session.' }) })
      return
    }
    // The profile gate answers 403 - the mapping changed under us (config is read per call).
    if (err instanceof Error && err.message === 'agent_profile_unmapped') {
      configPromise = null
      await loadAgentConfig()
      update({ starting: false, error: 'No agent profile is mapped to your account.' })
      return
    }
    // Mapped, but not for the engine that was asked for - usually a pending `codex <you> login`.
    if (err instanceof Error && err.message === 'agent_engine_unmapped') {
      configPromise = null
      const config = await loadAgentConfig()
      update({
        starting: false,
        error: `No ${state.engine ?? 'agent'} profile is set up for your account yet.`,
        engine: config.defaultEngine ?? null,
      })
      return
    }
    update({ starting: false, unavailable: true })
  }
}

async function startWithGate(command: string | undefined): Promise<void> {
  const config = await loadAgentConfig()
  if (!config.enabled) return
  setAgentOpen(true)
  // Unmapped: open the panel so the empty state can say why, but never attempt the start.
  if (agentProfileMissing(config)) return
  const active = await refreshAgentSession()
  if (active) {
    update({ conflict: { command, session: active } })
    return
  }
  await createSession(command)
}

/** Stage the engine the next session starts on. Does not touch a running session. */
export function setAgentEngine(engine: string): void {
  writeStored(ENGINE_KEY, engine)
  update({ engine })
}

/** The profile the next session will run under, for display. */
export function agentProfileForEngine(config: AgentConfig | null, engine: string | null): string | null {
  if (!config) return null
  return config.engines.find((e) => e.id === (engine ?? config.defaultEngine))?.profile ?? config.profile
}

/** The GenerateButton "Run now" entry point: open the sidebar and start `command` as the prompt. */
export const runAgent = (command: string): Promise<void> => startWithGate(command)

/** The sidebar's "New session" control (no initial prompt; the user types in the composer). */
export const startAgentSession = (): Promise<void> => startWithGate(undefined)

/** End (interrupt + remove) the attached session. */
export async function closeAgentSession(): Promise<void> {
  const id = state.sessionId
  if (!id) return
  try {
    await agentClient.deleteSession(id)
  } catch {
    // already gone (worker restart, another window closed it) - fall through to clearing state
  }
  writeStored(SESSION_KEY, null)
  update({ sessionId: undefined, session: undefined })
}

/** Resolve the takeover dialog: attach the live session, replace it, or stand down. */
export async function resolveAgentConflict(choice: 'open' | 'takeover' | 'cancel'): Promise<void> {
  const conflict = state.conflict
  if (!conflict) return
  if (choice === 'cancel') {
    update({ conflict: null })
    return
  }
  if (choice === 'open') {
    // Attaching to the running session cannot also deliver `command` - the store holds no
    // SessionHandle, so there is nothing to `send()` into. Rather than drop the prompt silently,
    // put it back on the clipboard so the user can paste it into the composer they are about to
    // see. (The real fix is a store-owned attached handle; tracked in _docs/FEATURES.md.)
    if (conflict.command) {
      try {
        void navigator.clipboard.writeText(conflict.command)
      } catch {
        // clipboard blocked (insecure origin / permissions) - the dialog already showed the command
      }
    }
    writeStored(SESSION_KEY, conflict.session.id)
    update({ conflict: null, open: true, sessionId: conflict.session.id, session: conflict.session })
    return
  }
  try {
    await agentClient.deleteSession(conflict.session.id)
  } catch {
    // it may have ended on its own - creating below re-hits the gate if not
  }
  update({ conflict: null, sessionId: undefined, session: undefined })
  await createSession(conflict.command)
}

export function setAgentOpen(open: boolean): void {
  writeStored(OPEN_KEY, open)
  update({ open })
}

/** Persist the dragged panel width; `null` restores the default. Clamping is the panel's job. */
export function setAgentWidth(width: number | null): void {
  writeStored(WIDTH_KEY, width)
  update({ width })
}

export function setAgentFullscreen(fullscreen: boolean): void {
  writeStored(FULLSCREEN_KEY, fullscreen)
  update({ fullscreen })
}

export function useAgent(): AgentState {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = (): void => setTick((t) => t + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return state
}
