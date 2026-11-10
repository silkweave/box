// The handler map over the real module tree (docs/AUTH.md "Roles and areas"), read statically so no
// feature boots: every handler classified, owned once, guarded, and every GET route and tRPC query
// carries @Read().

import 'reflect-metadata'
import { MetadataScanner, Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import '../app.module.js'
import { AuthGuard } from './auth.guard.js'
import { buildHandlerMap, discoverStatically, refusalFor, type HandlerPolicy } from './handler-map.js'

const { map, problems } = buildHandlerMap(discoverStatically(), new Reflector(), new MetadataScanner(), AuthGuard)
const policies = [...map.values()]

/** Handlers core itself serves (auth, users, roles, warehouse, signals, ops), not counting a feature's. */
const CORE_HANDLERS = 60

describe('the handler map', () => {
  it('classifies every handler, once, and finds none unguarded', () => {
    expect(problems.map((p) => `${p.key}: ${p.problem}`)).toEqual([])
    expect(policies.filter((p) => p.owner === 'core').length).toBeGreaterThan(CORE_HANDLERS)
  })

  // Admin-only handlers are outside roles (admin writes everywhere), so a GET there may write: the
  // OAuth callback stores tokens.
  it('marks every GET route and tRPC query @Read()', () => {
    const unread = policies.filter((p) => !p.read && (p.rest === 'GET' || p.trpc === 'query') && p.category.kind !== 'public' && !p.admin)
    expect(unread.map((p) => p.key)).toEqual([])
  })

  // A session never starts sessions (docs/AUTH.md "Session credentials"), with one opening: a chat
  // serving session may delegate to a feature's own jobs. Work and job sessions stay refused, so the
  // job a room agent starts cannot start another (depth 1); the tools themselves are listed by the
  // features that own them, so this holds for whatever is installed.
  it('refuses every session each job-starting tool, except a chat session where the tool opts in', () => {
    expect(policies.filter((p) => p.fromChat && !p.startsJob)).toEqual([])
    const admin = { role: 'admin', areas: new Map(), fallback: 'write', admin: true, revision: 0 } as never
    const work = { sid: 's1', kind: 'work' as const, scope: 'work:sam', toolset: null }
    const room = { ...work, kind: 'serving' as const, scope: 'room:r1' }
    const job = { ...work, kind: 'serving' as const, scope: 'job:box-notes-ask:a1' }
    for (const p of policies.filter((x) => x.startsJob)) {
      expect(refusalFor(p, admin)).toBeNull()
      expect(refusalFor(p, admin, work)).toEqual({ reason: 'session' })
      expect(refusalFor(p, admin, job)).toEqual({ reason: 'session' })
      expect(refusalFor(p, admin, room)).toEqual(p.fromChat ? null : { reason: 'session' })
      // A work session cannot pass for a chat one by its scope alone.
      expect(refusalFor(p, admin, { ...work, scope: 'room:r1' })).toEqual({ reason: 'session' })
    }
  })

  // The chat session still needs the area level and its toolset's list.
  it('lets a chat session through only with the area level and its toolset', () => {
    const room = { sid: 's1', kind: 'serving' as const, scope: 'room:r1', toolset: null }
    const ask = { key: 'Notes.ask', owner: 'notes', category: { kind: 'area', area: 'notes' }, mcp: 'notes-ask', startsJob: true, fromChat: true, read: false } as HandlerPolicy
    const get = { key: 'Notes.get', owner: 'notes', category: { kind: 'area', area: 'notes' }, mcp: 'notes-get', read: true } as HandlerPolicy
    const writer = { role: 'w', areas: new Map([['notes', 'write']]), fallback: 'none', admin: false, revision: 0 } as never
    const none = { role: 'n', areas: new Map(), fallback: 'none', admin: false, revision: 0 } as never
    expect(refusalFor(ask, writer, room)).toBeNull()
    expect(refusalFor(ask, none, room)).toEqual({ reason: 'area', area: 'notes', needed: 'write' })
    expect(refusalFor(ask, writer, { ...room, toolset: 'no-such-toolset' })).toEqual({ reason: 'session' })
    // Other tools of the same feature stay reachable for a work session.
    expect(refusalFor(get, writer, { ...room, kind: 'work', scope: 'work:sam' })).toBeNull()
  })
})
