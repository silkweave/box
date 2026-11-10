// The guard's two gates, pinned (docs/core/AUTH.md § 3.2).
//
// This is the file that would have caught the 2026-09-10-to-09-13 hole: `@Admin()` metadata that
// nothing reads fails OPEN and silently, and the only difference between a working tier and a
// decorative one is an assertion like these. The principal resolution is mocked - what is under
// test is the decision, not the token crypto.

import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authenticatePrincipal = vi.fn()
const resolvePrincipalById = vi.fn()
const verifySession = vi.fn()
const areaDestinationProblem = vi.fn()

vi.mock('@silkweave/box-core', () => ({
  SESSION_COOKIE: 'box_session',
  parseCookies: (raw?: string) => (raw ? Object.fromEntries([raw.split('=')]) : {}),
  authenticatePrincipal: (...a: unknown[]) => authenticatePrincipal(...a),
  resolvePrincipalById: (...a: unknown[]) => resolvePrincipalById(...a),
  verifySession: (...a: unknown[]) => verifySession(...a),
  // Built-ins write everywhere; `sales` reads crm only.
  accessOf: async (p: { role: string }) => p.role === 'sales'
    ? { role: 'sales', areas: new Map([['crm', 'read']]), fallback: 'none', admin: false, revision: 1 }
    : { role: p.role, areas: new Map(), fallback: 'write', admin: p.role === 'admin', revision: 1 },
  fillRequest: () => true,
  areaDestinationProblem: (...a: unknown[]) => areaDestinationProblem(...a),
  toolsetConnections: (toolset: string | null) => (toolset === 'crm-tools' ? ['stripe'] : []),
  agentToolset: (id: string) => (id === 'crm-tools' ? { boxTools: null } : undefined),
  levelOf: (a: { areas: Map<string, string>; fallback: string }, area: string) => a.areas.get(area) ?? a.fallback,
  levelCovers: (held: string, needed: string) => ['none', 'read', 'write'].indexOf(held) >= ['none', 'read', 'write'].indexOf(needed),
  // Core's composition (verify the cookie, resolve the row, persons only), over the mocks above.
  resolveSessionPrincipal: async () => {
    const claims = verifySession() as { sub: string } | null
    const principal = claims ? ((await resolvePrincipalById(claims.sub)) as { kind?: string } | null) : null
    return principal?.kind === 'human' ? principal : null
  },
}))

const { AuthGuard } = await import('./auth.guard.js')
const { IS_ADMIN, IS_PUBLIC } = await import('./auth.decorators.js')
const { installHandlerPolicies } = await import('./handler-map.js')
type Policy = import('./handler-map.js').HandlerPolicy

type Meta = { [IS_ADMIN]?: boolean; [IS_PUBLIC]?: boolean }

/** A guard whose reflector answers with `meta`, and a request shaped like the ones Nest passes. */
function harness(meta: Meta = {}, policy: Partial<Policy> = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => (meta as Record<string, boolean | undefined>)[key],
  } as unknown as Reflector
  const guard = new AuthGuard(reflector)
  const handler = function handler() {}
  installHandlerPolicies(new Map([[handler, { key: 'T.handler', owner: 'crm', category: { kind: 'area', area: 'crm' }, read: false, admin: Boolean(meta[IS_ADMIN]), ...policy } as Policy]]))
  const run = (req: Record<string, unknown>) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => class {},
    } as never)
  return { guard, run }
}

const bearer = (token = 't') => ({ headers: { authorization: `Bearer ${token}` }, method: 'POST' })
const cookie = () => ({ headers: { cookie: 'box_session=c', 'x-box-csrf': '1' }, method: 'POST' })

beforeEach(() => {
  vi.resetAllMocks()
  verifySession.mockReturnValue({ sub: 'someone' })
})

describe('authentication', () => {
  it('refuses a request with no credential', async () => {
    verifySession.mockReturnValue(null)
    await expect(harness().run({ headers: {}, method: 'GET' })).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('lets a @Public route through without one', async () => {
    verifySession.mockReturnValue(null)
    await expect(harness({ [IS_PUBLIC]: true }).run({ headers: {}, method: 'GET' })).resolves.toBe(true)
  })

  it('attaches the principal and how it proved itself', async () => {
    authenticatePrincipal.mockResolvedValue({ id: 'alice', display: 'alice', role: 'member', kind: 'human' })
    const req = bearer() as Record<string, unknown>
    await harness().run(req)
    expect(req.principal).toMatchObject({ id: 'alice', role: 'member', kind: 'human' })
    expect(req.credential).toBe('bearer')
  })
})

describe('authorization', () => {
  it('refuses a member on an @Admin route, on either credential', async () => {
    authenticatePrincipal.mockResolvedValue({ id: 'carol', display: 'carol', role: 'member', kind: 'human' })
    resolvePrincipalById.mockResolvedValue({ id: 'carol', display: 'carol', role: 'member', kind: 'human' })
    await expect(harness({ [IS_ADMIN]: true }).run(bearer())).rejects.toBeInstanceOf(ForbiddenException)
    await expect(harness({ [IS_ADMIN]: true }).run(cookie())).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('admits an admin on an @Admin route', async () => {
    authenticatePrincipal.mockResolvedValue({ id: 'alice', display: 'alice', role: 'admin', kind: 'human' })
    await expect(harness({ [IS_ADMIN]: true }).run(bearer())).resolves.toBe(true)
  })

  it('admits a member on an unmarked route - member is the whole working surface', async () => {
    authenticatePrincipal.mockResolvedValue({ id: 'carol', display: 'carol', role: 'member', kind: 'human' })
    await expect(harness().run(bearer())).resolves.toBe(true)
  })

  it('refuses a member BEFORE complaining about CSRF, so the error names the real reason', async () => {
    resolvePrincipalById.mockResolvedValue({ id: 'carol', display: 'carol', role: 'member', kind: 'human' })
    const noCsrf = { headers: { cookie: 'box_session=c' }, method: 'POST' }
    await expect(harness({ [IS_ADMIN]: true }).run(noCsrf)).rejects.toThrow(/admin only/)
  })

  it('still enforces CSRF for an admin on a cookie-authed mutation', async () => {
    resolvePrincipalById.mockResolvedValue({ id: 'alice', display: 'alice', role: 'admin', kind: 'human' })
    const noCsrf = { headers: { cookie: 'box_session=c' }, method: 'POST' }
    await expect(harness({ [IS_ADMIN]: true }).run(noCsrf)).rejects.toThrow(/CSRF/)
  })
})

describe('area access', () => {
  const sales = { id: 'sam', display: 'sam', role: 'sales', kind: 'human' }

  it('a read level reaches a @Read() handler of the area, not a write one', async () => {
    authenticatePrincipal.mockResolvedValue(sales)
    await expect(harness({}, { read: true }).run(bearer())).resolves.toBe(true)
    await expect(harness({}, { read: false }).run(bearer())).rejects.toMatchObject({ response: { error: 'area_access', area: 'crm', needed: 'write' } })
  })

  it('no level on the area refuses even a read', async () => {
    authenticatePrincipal.mockResolvedValue(sales)
    await expect(harness({}, { read: true, owner: 'notes', category: { kind: 'area', area: 'notes' } }).run(bearer())).rejects.toMatchObject({ response: { error: 'area_access', area: 'notes', needed: 'read' } })
  })

  it('resource and authenticated handlers pass the guard; the handler decides', async () => {
    authenticatePrincipal.mockResolvedValue(sales)
    await expect(harness({}, { owner: 'core', category: { kind: 'resource', resource: 'run' } }).run(bearer())).resolves.toBe(true)
    await expect(harness({}, { owner: 'core', category: { kind: 'authenticated' } }).run(bearer())).resolves.toBe(true)
  })

  it('a handler missing from the map is refused', async () => {
    authenticatePrincipal.mockResolvedValue({ id: 'alice', display: 'alice', role: 'admin', kind: 'human' })
    const { run } = harness()
    installHandlerPolicies(new Map())
    await expect(run(bearer())).rejects.toThrow(/not classified/)
  })
})

describe('agent sessions', () => {
  const scout = (scope: string, kind: 'serving' | 'work' = 'serving', toolset: string | null = null) =>
    ({ id: 'scout', display: 'Scout', role: 'member', kind: 'agent', session: { sid: 's1', kind, scope, toolset } })
  const notesAsk: Partial<Policy> = { owner: 'notes', category: { kind: 'area', area: 'notes' }, mcp: 'notes-ask', startsJob: true, fromChat: true, answersCaller: true }
  const triggerRun: Partial<Policy> = { owner: 'automation', category: { kind: 'area', area: 'automation' }, mcp: 'trigger-run', startsJob: true }

  it('a chat serving session may start a notes job; a job or work session may not, nor anyone TriggerRun', async () => {
    areaDestinationProblem.mockResolvedValue(null)
    authenticatePrincipal.mockResolvedValue(scout('room:r1'))
    await expect(harness({}, notesAsk).run(bearer())).resolves.toBe(true)
    await expect(harness({}, triggerRun).run(bearer())).rejects.toThrow(/not available to this agent session/)
    authenticatePrincipal.mockResolvedValue(scout('job:box-notes-ask:a1'))
    await expect(harness({}, notesAsk).run(bearer())).rejects.toThrow(/not available to this agent session/)
    authenticatePrincipal.mockResolvedValue(scout('room:r1', 'work'))
    await expect(harness({}, notesAsk).run(bearer())).rejects.toThrow(/not available to this agent session/)
  })

  it("an agent writing into an area destination is refused 403 coverage when a reader does not cover it", async () => {
    authenticatePrincipal.mockResolvedValue(scout('room:r1', 'serving', 'crm-tools'))
    areaDestinationProblem.mockResolvedValue('not every reader of the notes covers scout: Dita (viewer) lacks crm write held by Scout in the notes')
    const write: Partial<Policy> = { owner: 'notes', category: { kind: 'area', area: 'notes' }, mcp: 'notes-page-write' }
    await expect(harness({}, write).run(bearer())).rejects.toMatchObject({ status: 403, response: { error: 'coverage', area: 'notes', message: expect.stringMatching(/Dita \(viewer\) lacks crm write/) } })
    expect(areaDestinationProblem).toHaveBeenCalledWith('notes', 'scout', ['stripe'])
    // Reads are not output: no destination check.
    areaDestinationProblem.mockClear()
    await expect(harness({}, { ...write, read: true }).run(bearer())).resolves.toBe(true)
    expect(areaDestinationProblem).not.toHaveBeenCalled()
    // NotesAsk's answer returns to the caller only: no notes destination check for the asking agent.
    await expect(harness({}, notesAsk).run(bearer())).resolves.toBe(true)
    expect(areaDestinationProblem).not.toHaveBeenCalled()
    // A person writing is judged by role alone.
    authenticatePrincipal.mockResolvedValue({ id: 'carol', display: 'carol', role: 'member', kind: 'human' })
    await expect(harness({}, write).run(bearer())).resolves.toBe(true)
    expect(areaDestinationProblem).not.toHaveBeenCalled()
  })
})
