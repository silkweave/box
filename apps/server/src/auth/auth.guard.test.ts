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

vi.mock('@silkweave/box-core', () => ({
  SESSION_COOKIE: 'box_session',
  parseCookies: (raw?: string) => (raw ? Object.fromEntries([raw.split('=')]) : {}),
  authenticatePrincipal: (...a: unknown[]) => authenticatePrincipal(...a),
  resolvePrincipalById: (...a: unknown[]) => resolvePrincipalById(...a),
  verifySession: (...a: unknown[]) => verifySession(...a),
  // Core's composition (verify the cookie, resolve the row, persons only), over the mocks above.
  resolveSessionPrincipal: async () => {
    const claims = verifySession() as { sub: string } | null
    const principal = claims ? ((await resolvePrincipalById(claims.sub)) as { kind?: string } | null) : null
    return principal?.kind === 'human' ? principal : null
  },
}))

const { AuthGuard } = await import('./auth.guard.js')
const { IS_ADMIN, IS_PUBLIC } = await import('./auth.decorators.js')

type Meta = { [IS_ADMIN]?: boolean; [IS_PUBLIC]?: boolean }

/** A guard whose reflector answers with `meta`, and a request shaped like the ones Nest passes. */
function harness(meta: Meta = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => (meta as Record<string, boolean | undefined>)[key],
  } as unknown as Reflector
  const guard = new AuthGuard(reflector)
  const run = (req: Record<string, unknown>) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
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
