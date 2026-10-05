import { WorkerDeckClient } from '@workerdeck/client'
import type { SessionInfo } from '@workerdeck/protocol'

/** The stable Builder host is a shared Box control plane for one dedicated live branch. */
const CONTROL_BASE = '/api/builder-control'

const wsOrigin = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

/**
 * Builder sessions use a separate authenticated WorkerDeck mount. The server chooses the shared
 * session and limits it to authenticated administrators; the browser only chooses which UI to render.
 */
export const builderClient = new WorkerDeckClient({
  baseUrl: '/builder-agent/v1',
  headers: { 'x-box-csrf': '1' },
  buildWsUrl: (sessionId, afterSeq, truncateResults, imageRefs) =>
    `${wsOrigin()}/builder-agent/v1/sessions/${encodeURIComponent(sessionId)}/ws?afterSeq=${afterSeq}${truncateResults ? "&truncateResults=1" : ""}${imageRefs ? "&imageRefs=1" : ""}`,
})

export type BuilderProviderState = 'checking' | 'ready' | 'sign-in-required' | 'unavailable' | 'unknown'
export type BuilderApplicationStatus = 'starting' | 'running' | 'stopped' | 'failed'

export interface BuilderProfile {
  name: string
  engine: string
  available?: boolean
  unavailableReason?: string
}

export interface BuilderBackup {
  id: string
  createdAt: string
}

export interface BuilderApplication {
  status: BuilderApplicationStatus
  message?: string
  revision?: string | null
}

export interface BuilderUnavailableSession {
  id: string
  startedAt: string
}

export interface BuilderControlState {
  session: SessionInfo | null
  unavailableSession: BuilderUnavailableSession | null
  maintenance: boolean
  branch: string | null
  baseRevision: string | null
  backups: BuilderBackup[]
  application: BuilderApplication
  ui: { version: string | null; building: boolean; error: string | null }
  web: BuilderWebState
  principal: { id: string; display: string; role: 'admin' | 'member' }
  profiles: BuilderProfile[]
}

export interface BuilderWebRelease { version: string; createdAt: string; sourceSha: string | null; dirty: boolean }
/** `dev`: box dev serves every page through Vite. `built`: everyone else loads the promoted release. */
export type BuilderWebState =
  | { mode: 'dev' }
  | { mode: 'built'; promoting: boolean; error: string | null; release: BuilderWebRelease | null }

export interface BuilderReadiness {
  provider: BuilderProviderState
  message: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

const asApplicationStatus = (value: unknown): BuilderApplicationStatus =>
  value === 'starting' || value === 'running' || value === 'stopped' || value === 'failed' ? value : 'stopped'

const normalizeWeb = (raw: unknown): BuilderWebState => {
  if (!isRecord(raw) || raw.mode !== 'built') return { mode: 'dev' }
  const release = isRecord(raw.release) && typeof raw.release.version === 'string' && typeof raw.release.createdAt === 'string'
    ? { version: raw.release.version, createdAt: raw.release.createdAt, sourceSha: asText(raw.release.sourceSha) ?? null, dirty: raw.release.dirty === true }
    : null
  return { mode: 'built', promoting: raw.promoting === true, error: asText(raw.error) ?? null, release }
}

const normalizeState = (raw: unknown): BuilderControlState => {
  const body = isRecord(raw) && isRecord(raw.state) ? raw.state : isRecord(raw) ? raw : {}
  const application = isRecord(body.application) ? body.application : {}
  const session = isRecord(body.session) ? (body.session as unknown as SessionInfo) : null
  const unavailableSession = isRecord(body.unavailableSession) && typeof body.unavailableSession.id === 'string' && typeof body.unavailableSession.startedAt === 'string'
    ? { id: body.unavailableSession.id, startedAt: body.unavailableSession.startedAt }
    : null
  const profiles = Array.isArray(body.profiles)
    ? body.profiles.filter(isRecord).flatMap((profile) => {
        const name = asText(profile.name)
        const engine = asText(profile.engine)
        return name && engine
          ? [{ name, engine, available: typeof profile.available === 'boolean' ? profile.available : undefined, unavailableReason: asText(profile.unavailableReason) }]
          : []
      })
    : []
  const backups = Array.isArray(body.backups)
    ? body.backups.filter(isRecord).flatMap((backup) => {
        const id = asText(backup.id)
        const createdAt = asText(backup.createdAt)
        return id && createdAt ? [{ id, createdAt }] : []
      })
    : []
  const principal = isRecord(body.principal) && typeof body.principal.id === 'string' && typeof body.principal.display === 'string'
    ? { id: body.principal.id, display: body.principal.display, role: body.principal.role === 'member' ? 'member' as const : 'admin' as const }
    : { id: '', display: '', role: 'member' as const }
  return {
    session,
    ui: { version: isRecord(body.ui) ? asText(body.ui.version) ?? null : null, building: isRecord(body.ui) && body.ui.building === true, error: isRecord(body.ui) ? asText(body.ui.error) ?? null : null },
    web: normalizeWeb(body.web),
    unavailableSession,
    maintenance: body.maintenance === true,
    branch: asText(body.branch) ?? null,
    baseRevision: asText(body.baseRevision) ?? null,
    backups,
    application: {
      status: asApplicationStatus(application.status),
      message: asText(application.message),
      revision: asText(application.revision) ?? null,
    },
    principal,
    profiles,
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${CONTROL_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-box-csrf': '1', ...init?.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = isRecord(body) && typeof body.message === 'string' ? body.message : `Builder control request failed (${response.status})`
    throw new Error(message)
  }
  return body
}

export function loadBuilderControlState(): Promise<BuilderControlState> {
  return request('/state', { signal: AbortSignal.timeout(8_000) }).then(normalizeState)
}

export interface BuilderPendingChanges {
  fingerprint: string | null
  files: Array<{ path: string; status: string }>
  truncated: boolean
}

/** Uncommitted source changes that starting Builder would adopt onto its new live branch. */
export async function loadBuilderPendingChanges(): Promise<BuilderPendingChanges> {
  const body = await request('/pending-changes', { signal: AbortSignal.timeout(15_000) })
  const raw = isRecord(body) ? body : {}
  const files = Array.isArray(raw.files)
    ? raw.files.filter(isRecord).flatMap((file) => typeof file.path === 'string' && typeof file.status === 'string' ? [{ path: file.path, status: file.status }] : [])
    : []
  return { fingerprint: asText(raw.fingerprint) ?? null, files, truncated: raw.truncated === true }
}

export function startBuilderSession(engine?: string, adoptChanges?: string): Promise<void> {
  return request('/start', { method: 'POST', body: JSON.stringify({ ...(engine && { engine }), ...(adoptChanges && { adoptChanges }) }) }).then(() => undefined)
}

export function setBuilderMaintenance(enabled: boolean): Promise<void> {
  return request('/maintenance', { method: 'POST', body: JSON.stringify({ enabled }) }).then(() => undefined)
}

export function takeBuilderBackup(): Promise<void> {
  return request('/backup', { method: 'POST', body: '{}' }).then(() => undefined)
}

export function restartBuilder(check = true): Promise<void> {
  return request('/restart', { method: 'POST', body: JSON.stringify({ check }) }).then(() => undefined)
}

/** Typecheck and publish the current web source to everyone outside Builder (box start only). */
export function promoteBuilderWeb(check = true): Promise<void> {
  return request('/promote', { method: 'POST', body: JSON.stringify({ check }) }).then(() => undefined)
}

export function restoreBuilder(id: string): Promise<void> {
  return request('/restore', { method: 'POST', body: JSON.stringify({ id }) }).then(() => undefined)
}

export function stopBuilder(): Promise<void> {
  return request('/stop', { method: 'POST', body: '{}' }).then(() => undefined)
}

/** Derive provider readiness from the supervisor's actual WorkerDeck profile probe. */
export function builderReadiness(state: BuilderControlState): BuilderReadiness {
  if (state.profiles.length === 0) return { provider: 'unknown', message: 'No Builder provider profile is available.' }
  const profile = state.profiles.find((candidate) => candidate.available === true) ?? state.profiles[0]
  if (profile.available === true) return { provider: 'ready', message: `${profile.name} is ready on this Box host.` }
  const reason = profile.unavailableReason ?? 'The selected provider profile is not currently available.'
  const signedOut = reason.startsWith('codex is not logged in') || reason.startsWith('no usable Claude credentials')
  return { provider: signedOut ? 'sign-in-required' : 'unknown', message: reason }
}

export function refreshBuilderUi(): Promise<void> {
  return request('/refresh-ui', { method: 'POST', body: '{}' }).then(() => undefined)
}

export interface BuilderReviewData {
  fingerprint: string
  branch: string
  targetBranch: string | null
  baseRevision: string
  headRevision: string
  files: Array<{ path: string; status: string }>
  commits: Array<{ sha: string; message: string }>
  diff: string
  truncated: boolean
}
/** One `box verify` check with its live progress (see the supervisor's verification record). */
export interface BuilderVerificationStep {
  id: string
  name: string
  phase: string
  command: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped'
  elapsed: number
  expected?: number
  progress?: { done: number; total?: number; unit: string }
  cached: boolean
  warnings: string[]
  diagnostics: string[]
  exitCode: number | null
  log: string
}
export interface BuilderVerificationState {
  fingerprint: string
  status: 'running' | 'passed' | 'failed'
  output: string
  checkedAt: string
  warnings: boolean
  steps?: BuilderVerificationStep[]
  elapsed?: number
}
export interface BuilderReviewState {
  review: BuilderReviewData
  verification: BuilderVerificationState | null
}
/**
 * Sends a turn to the shared Builder session from outside its composer. A short-lived second
 * attachment carries the message; the visible session panel shows the turn like any other.
 */
export function sendBuilderMessage(sessionId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = builderClient.attach(sessionId, { reconnect: false, truncateResults: true })
    const timer = setTimeout(() => { handle.detach(); reject(new Error('The Builder session did not answer. Try again.')) }, 10_000)
    const off = handle.on('attached', () => {
      off(); clearTimeout(timer)
      handle.send(text)
      // Leave the socket open briefly so the frame is flushed before the attachment closes.
      setTimeout(() => handle.detach(), 1000)
      resolve()
    })
  })
}
export const loadBuilderReview = (): Promise<BuilderReviewState> => request('/review', { signal: AbortSignal.timeout(15_000) }) as Promise<BuilderReviewState>
export const verifyBuilderReview = (fingerprint: string): Promise<unknown> => request('/verify-review', { method: 'POST', body: JSON.stringify({ fingerprint }) })
export const checkpointBuilderReview = (fingerprint: string, message: string): Promise<unknown> => request('/checkpoint', { method: 'POST', body: JSON.stringify({ fingerprint, message }) })
export const finishBuilderReview = (fingerprint: string, message: string): Promise<unknown> => request('/finish', { method: 'POST', body: JSON.stringify({ fingerprint, message }) })
