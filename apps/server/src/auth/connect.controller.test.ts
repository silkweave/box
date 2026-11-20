// The consent decision belongs to the session's person, and an Allow is refused when that person is
// not the one the consent page showed (an account switch in another tab while the page stayed open).

import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const approve = vi.fn(async (_id: string, _sub: string, _info?: { device?: string | null }) => 'http://127.0.0.1:43123/callback?code=c')
const deny = vi.fn(async (_id: string) => 'http://127.0.0.1:43123/callback?error=access_denied')

vi.mock('@silkweave/box-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silkweave/box-core')>()),
  mcpAuthExtension: () => ({ signIn: { approve, deny } }),
  sameOrigin: () => true,
}))

const { ConnectController } = await import('./connect.controller.js')

const asSession = (id: string) => ({ principal: { id, display: id, kind: 'human', role: 'member' }, credential: 'session', headers: {} }) as never

describe('connectDecide', () => {
  beforeEach(() => {
    approve.mockClear()
    deny.mockClear()
  })

  it('approves for the session person when the page showed them', async () => {
    const res = await new ConnectController().decide({ id: 'r1', allow: true, shown: 'alice' }, asSession('alice'))
    expect(res.redirectTo).toContain('code=')
    expect(approve).toHaveBeenCalledWith('r1', 'alice', { device: null })
  })

  it("labels the approval with the browser's User-Agent", async () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
    const req = { principal: { id: 'alice', display: 'alice', kind: 'human', role: 'member' }, credential: 'session', headers: { 'user-agent': ua } } as never
    await new ConnectController().decide({ id: 'r1', allow: true, shown: 'alice' }, req)
    expect(approve).toHaveBeenCalledWith('r1', 'alice', { device: 'Firefox on Linux' })
  })

  it('refuses an Allow after the session switched to another person, approving nothing', async () => {
    await expect(new ConnectController().decide({ id: 'r1', allow: true, shown: 'alice' }, asSession('bob'))).rejects.toBeInstanceOf(ConflictException)
    await expect(new ConnectController().decide({ id: 'r1', allow: true }, asSession('bob'))).rejects.toBeInstanceOf(ConflictException)
    expect(approve).not.toHaveBeenCalled()
  })

  it('never lets the shown id pick the owner, and a Deny needs no match', async () => {
    await expect(new ConnectController().decide({ id: 'r1', allow: true, shown: 'bob' }, asSession('alice'))).rejects.toBeInstanceOf(ConflictException)
    await new ConnectController().decide({ id: 'r1', allow: false, shown: 'alice' }, asSession('bob'))
    expect(deny).toHaveBeenCalledWith('r1')
    expect(approve).not.toHaveBeenCalled()
  })
})
