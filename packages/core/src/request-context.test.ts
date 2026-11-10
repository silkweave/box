import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Access } from './auth/access.js'
import { asBootstrap, asSystem, bindStream, canAccess, captureFrame, currentScope, fillRequest, freshRequestFrame, hasAdminAuthority, requireAccess, runInFrame, runInRequest, withoutContext } from './request-context.js'

const member: Access = { role: 'member', areas: new Map([['crm', 'read']]), fallback: 'none', admin: false, revision: 1 }
const ana = { id: 'ana', display: 'Ana', role: 'member' as const, kind: 'human' as const }

describe('request context', () => {
  it('denies area data without a filled holder, and decides by access once filled', () => {
    expect(withoutContext(() => canAccess('crm', 'read'))).toBe(false)
    runInRequest(() => {
      expect(canAccess('crm', 'read')).toBe(false)
      expect(() => requireAccess('crm', 'read')).toThrow(expect.objectContaining({ name: 'AreaAccessError', area: 'crm', needed: 'read' }))
      expect(fillRequest({ principal: ana, access: member })).toBe(true)
      expect(canAccess('crm', 'read')).toBe(true)
      expect(canAccess('crm', 'write')).toBe(false)
      expect(canAccess('sink', 'read')).toBe(false)
      expect(hasAdminAuthority()).toBe(false)
    })
    expect(withoutContext(() => fillRequest({ principal: ana, access: member }))).toBe(false)
  })

  it('bootstrap reaches no area; system reaches every area, only inside its callback', async () => {
    expect(asBootstrap(() => canAccess('crm', 'read'))).toBe(false)
    expect(asBootstrap(() => currentScope().kind)).toBe('bootstrap')
    await runInRequest(async () => {
      fillRequest({ principal: ana, access: member })
      expect(await asSystem('test', async () => canAccess('sink', 'write'))).toBe(true)
      expect(canAccess('sink', 'write')).toBe(false)
    })
    expect(() => asSystem('', () => 1)).toThrow()
  })

  it('a captured frame carries into a callback dispatched from elsewhere', async () => {
    const bus = new EventEmitter()
    const seen: string[] = []
    runInRequest(() => {
      fillRequest({ principal: ana, access: member })
      const frame = captureFrame()
      withoutContext(() => bus.on('x', () => seen.push(runInFrame(frame, () => currentScope().kind))))
    })
    withoutContext(() => bus.emit('x'))
    expect(seen).toEqual(['principal'])
  })

  it('bindStream runs every step in its frame and closes the source on early exit', async () => {
    const frame = freshRequestFrame()
    let closed = false
    async function* source(): AsyncGenerator<string> {
      try {
        for (;;) {
          await new Promise((r) => setTimeout(r, 1))
          yield currentScope().kind
        }
      } finally {
        closed = true
      }
    }
    runInFrame(frame, () => fillRequest({ principal: ana, access: member }))
    const out: string[] = []
    // Consumed with no frame of its own, as a WebSocket handler would.
    await withoutContext(async () => {
      for await (const kind of bindStream(frame, source)) {
        out.push(kind)
        if (out.length === 3) break
      }
    })
    expect(out).toEqual(['principal', 'principal', 'principal'])
    expect(closed).toBe(true)
  })
})
