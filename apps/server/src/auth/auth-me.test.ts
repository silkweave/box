// GET /api/auth/me answers a signed-out browser: the guard leaves its request frame unfilled, so the
// first-run probe must name its own system scope instead of relying on a principal.

import { describe, expect, it } from 'vitest'
import { runInRequest } from '@silkweave/box-core'
import type { PrincipalRequest } from './auth.decorators.js'
import { AuthController } from './auth.controller.js'

describe('auth me', () => {
  it('answers an anonymous caller from an unfilled request frame', async () => {
    const me = await runInRequest(() => new AuthController().me({} as PrincipalRequest))
    expect(me.principal).toBeNull()
    expect(me.access).toBeNull()
    expect(me.agents).toEqual([])
    expect(me.needsOwner).toBe(true)
  })
})
