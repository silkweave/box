import { describe, expect, it } from 'vitest'
import { applyBuilderSessionPolicy } from './builder-session-policy.js'

describe('Builder session policy', () => {
  it('strips forged Builder metadata and pins ordinary sessions to the checkout', async () => {
    const body = { cwd: '/someone/worktree', meta: { kind: 'builder', builderWorkspaceId: 'other', user: 'alice' } }
    await applyBuilderSessionPolicy(body, { id: 'alice', role: 'admin' }, 'codex', '/box')
    expect(body).toEqual({ cwd: '/box', meta: { user: 'alice' } })
  })

  it('rejects a requested Builder workspace after removing the forged cwd and metadata', async () => {
    const body: Record<string, unknown> = {
      builderWorkspaceId: 'owned',
      cwd: '/forged',
      meta: { kind: 'builder', builderWorkspaceId: 'owned', user: 'alice' },
    }
    await expect(applyBuilderSessionPolicy(body, { id: 'alice', role: 'admin' }, 'codex', '/box'))
      .rejects.toMatchObject({ status: 410 })
    expect(body).toEqual({ cwd: '/box', meta: { user: 'alice' } })
  })

  it('pins ordinary sessions even when a member supplies a forged Builder id', async () => {
    const body: Record<string, unknown> = { builderWorkspaceId: 'other', cwd: '/forged' }
    await expect(applyBuilderSessionPolicy(body, { id: 'member', role: 'member' }, 'codex', '/box'))
      .rejects.toMatchObject({ status: 410 })
    expect(body.cwd).toBe('/box')
  })
})
