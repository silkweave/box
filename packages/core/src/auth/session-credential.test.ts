import { describe, expect, it } from 'vitest'
import { admitSessionCredential, closeSessionCredential, closeSessionsWhere, isSessionCredential, liveSessions, openSessionCredential, recheckLiveSessions, renewSessionCredential, sessionServes, verifySessionCredential } from './session-credential.js'

const open = (over: Partial<Parameters<typeof openSessionCredential>[0]> = {}, now?: number) =>
  openSessionCredential({ sub: 'nova', kind: 'serving', scope: 'room:pipeline', toolset: null, ...over }, now)

describe('session credentials', () => {
  it('verify while live, and stop the moment the session closes', () => {
    const { sid, credential } = open()
    expect(isSessionCredential(credential)).toBe(true)
    expect(verifySessionCredential(credential)).toEqual({ sub: 'nova', sid, kind: 'serving', scope: 'room:pipeline', toolset: null })
    expect(closeSessionCredential(sid)).toBe(true)
    expect(verifySessionCredential(credential)).toBeNull()
  })

  it('refuse an expired, a tampered or a forged credential', () => {
    const now = Date.now()
    const { credential } = open({ ttlMs: 1_000 })
    expect(verifySessionCredential(credential, now + 2_000)).toBeNull()
    const [head, body, sig] = credential.slice('bx-session-'.length).split('.')
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString()) as Record<string, unknown>
    const widened = Buffer.from(JSON.stringify({ ...claims, sub: 'boss' })).toString('base64url')
    expect(verifySessionCredential(`bx-session-${head}.${widened}.${sig}`)).toBeNull()
    expect(verifySessionCredential(`bx-session-${head}.${body}.${'A'.repeat(sig!.length)}`)).toBeNull()
    expect(verifySessionCredential('bx-session-nonsense')).toBeNull()
  })

  it('renews only a live credential whose recheck passes; a refused recheck ends the session', async () => {
    let ok = true
    const { sid, credential } = open({ recheck: () => (ok ? null : 'Dita no longer covers Nova') })
    const renewed = await renewSessionCredential(credential)
    expect(verifySessionCredential(renewed.credential)?.sid).toBe(sid)
    ok = false
    await expect(renewSessionCredential(renewed.credential)).rejects.toThrow(/no longer covers/)
    expect(verifySessionCredential(renewed.credential)).toBeNull()
  })

  it('closes every session a policy change breaks', () => {
    const a = open({ scope: 'room:a' })
    const b = open({ scope: 'room:b' })
    expect(closeSessionsWhere((g) => g.scope === 'room:a')).toEqual([a.sid])
    expect(verifySessionCredential(a.credential)).toBeNull()
    expect(verifySessionCredential(b.credential)?.scope).toBe('room:b')
  })

  it('binds job and room controls to the scope a session serves; callers without one pass', () => {
    expect(sessionServes(undefined, 'job:box-notes-ask:a1')).toBe(true)
    expect(sessionServes(null, 'job:box-notes-ask:a1')).toBe(true)
    expect(sessionServes({ scope: 'job:box-notes-ask:a1' }, 'job:box-notes-ask:a1')).toBe(true)
    expect(sessionServes({ scope: 'job:box-notes-ask:a2' }, 'job:box-notes-ask:a1')).toBe(false)
    expect(sessionServes({ scope: 'job:box-notes-ask:a1x' }, 'job:box-notes-ask:a1')).toBe(false)
    expect(sessionServes({ scope: 'room:r1' }, 'job:box-notes-ask:a1')).toBe(false)
  })

  it('drops a session whose newest credential expired, used or not; renewal moves the bound', async () => {
    const t0 = 1_000_000
    const unused = open({ ttlMs: 10 }, t0)
    expect(verifySessionCredential(unused.credential, t0 + 20)).toBeNull()
    expect(liveSessions().some((s) => s.sid === unused.sid)).toBe(false)
    const never = openSessionCredential({ sub: 'nova', kind: 'serving', scope: 'job:x:1', ttlMs: 10 }, t0)
    await recheckLiveSessions(t0 + 20)
    expect(liveSessions().some((s) => s.sid === never.sid)).toBe(false)
    const now = Date.now()
    const live = open({ ttlMs: 60_000 }, now)
    const renewed = await renewSessionCredential(live.credential, now + 50_000)
    expect(verifySessionCredential(renewed.credential, now + 100_000)?.sid).toBe(live.sid)
    expect(verifySessionCredential(renewed.credential, now + 120_000)).toBeNull()
    expect(liveSessions().some((s) => s.sid === live.sid)).toBe(false)
  })

  it('admits each request through the session\'s own check; a refusal or a throw ends the session', async () => {
    let refusal: string | null = null
    const a = open({ admit: () => refusal })
    expect(await admitSessionCredential(a.sid)).toBe(true)
    refusal = 'Work has been turned off'
    expect(await admitSessionCredential(a.sid)).toBe(false)
    expect(verifySessionCredential(a.credential)).toBeNull()
    const b = open({ admit: () => { throw new Error('read failed') } })
    expect(await admitSessionCredential(b.sid)).toBe(false)
    expect(verifySessionCredential(b.credential)).toBeNull()
    // Empty messages and empty strings still refuse (fail closed, not on the text).
    for (const admit of [() => { throw new Error('') }, () => { throw '' }, () => '', async () => { throw new Error('') }]) {
      const e = open({ admit })
      expect(await admitSessionCredential(e.sid)).toBe(false)
      expect(verifySessionCredential(e.credential)).toBeNull()
    }
    for (const recheck of [() => { throw new Error('') }, () => { throw '' }, () => '']) {
      const r = open({ recheck })
      expect(await recheckLiveSessions()).toContain(r.sid)
      expect(verifySessionCredential(r.credential)).toBeNull()
      const n = open({ recheck })
      await expect(renewSessionCredential(n.credential)).rejects.toThrow(/session ended/)
      expect(verifySessionCredential(n.credential)).toBeNull()
    }
    const c = open()
    expect(await admitSessionCredential(c.sid)).toBe(true)
    expect(await admitSessionCredential('no-such-sid')).toBe(false)
    closeSessionCredential(c.sid)
  })
})
