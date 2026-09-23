import { describe, expect, it } from 'vitest'
import { BuilderSupervisorAuth, BUILDER_SUPERVISOR_LEASE_MS, type BuilderSupervisorVerification } from './builder-auth.js'

describe('Builder supervisor recovery auth', () => {
  it('authenticates an admin while healthy and refreshes the bounded lease', async () => {
    let now = 10_000
    const admin = { id: 'alice', display: 'Alice', role: 'admin' as const }
    const auth = new BuilderSupervisorAuth(() => admin, { now: () => now })

    await expect(auth.authenticate('box-session')).resolves.toEqual({
      ok: true,
      principal: admin,
      source: 'healthy',
      expiresAt: now + BUILDER_SUPERVISOR_LEASE_MS,
    })
    now += 1_000
    await expect(auth.authenticate('box-session')).resolves.toMatchObject({ source: 'healthy', expiresAt: now + BUILDER_SUPERVISOR_LEASE_MS })
  })

  it('does not create a recovery lease for a healthy member or explicit denial', async () => {
    let result: BuilderSupervisorVerification = { id: 'member', display: 'Member', role: 'member' }
    const auth = new BuilderSupervisorAuth(() => result)

    await expect(auth.authenticate('member-session')).resolves.toMatchObject({ ok: false, state: 'denied', reason: 'not_admin' })
    result = 'unavailable'
    await expect(auth.authenticate('member-session')).resolves.toMatchObject({ ok: false, state: 'unavailable', reason: 'app_unavailable' })
  })

  it('uses an existing admin lease only while the child is unavailable and never extends it', async () => {
    let now = 10_000
    let result: BuilderSupervisorVerification = { id: 'alice', display: 'Alice', role: 'admin' }
    const auth = new BuilderSupervisorAuth(() => result, { now: () => now, leaseMs: 1_000 })

    await auth.authenticate('admin-session')
    result = 'unavailable'
    now += 500
    await expect(auth.authenticate('admin-session')).resolves.toMatchObject({ ok: true, source: 'recovery', expiresAt: 11_000 })
    now += 501
    await expect(auth.authenticate('admin-session')).resolves.toMatchObject({ ok: false, state: 'unavailable', reason: 'lease_expired' })
  })

  it('revokes the cached lease immediately on healthy non-admin, logout, or missing cookie', async () => {
    let result: BuilderSupervisorVerification = { id: 'alice', display: 'Alice', role: 'admin' }
    const auth = new BuilderSupervisorAuth(() => result, { leaseMs: 10_000 })

    await auth.authenticate('admin-session')
    result = { id: 'alice', display: 'Alice', role: 'member' }
    await expect(auth.authenticate('admin-session')).resolves.toMatchObject({ ok: false, reason: 'not_admin' })
    result = 'unavailable'
    await expect(auth.authenticate('admin-session')).resolves.toMatchObject({ ok: false, state: 'unavailable', reason: 'app_unavailable' })

    result = { id: 'alice', display: 'Alice', role: 'admin' }
    await auth.authenticate('admin-session')
    auth.logout('admin-session')
    result = 'unavailable'
    await expect(auth.authenticate('admin-session')).resolves.toMatchObject({ ok: false, state: 'unavailable', reason: 'app_unavailable' })
    await expect(auth.authenticate(undefined)).resolves.toEqual({ ok: false, state: 'denied', reason: 'missing_cookie' })
  })

  it('does not let a different cookie use an admin lease', async () => {
    let result: BuilderSupervisorVerification = { id: 'alice', display: 'Alice', role: 'admin' }
    const auth = new BuilderSupervisorAuth(() => result, { leaseMs: 10_000 })
    await auth.authenticate('admin-session')
    result = 'unavailable'

    await expect(auth.authenticate('other-session')).resolves.toMatchObject({ ok: false, state: 'unavailable', reason: 'app_unavailable' })
  })

  it('requires a positive integer lease duration', () => {
    expect(() => new BuilderSupervisorAuth(() => 'unavailable', { leaseMs: 0 })).toThrow(/positive integer/)
    expect(() => new BuilderSupervisorAuth(() => 'unavailable', { leaseMs: 1.5 })).toThrow(/positive integer/)
  })
})
