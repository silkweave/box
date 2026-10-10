import { describe, expect, it } from 'vitest'
import { platformClient, publishedPosts, registerPlatformClient, registerPublishedPostSource, requirePlatformClient } from './platforms.js'

describe('platform client port', () => {
  it('names the missing powerup until a client registers, and refuses a second one', async () => {
    expect(platformClient('reddit')).toBeNull()
    expect(() => requirePlatformClient('reddit')).toThrow(/Data Sync "reddit" powerup/)
    const client = { unreadInbox: async () => [] }
    const off = registerPlatformClient('reddit', client)
    expect(requirePlatformClient('reddit')).toBe(client)
    expect(() => registerPlatformClient('reddit', client)).toThrow(/registered twice/)
    off()
    expect(platformClient('reddit')).toBeNull()
  })

  it('collects published posts from every registered source', async () => {
    const offA = registerPublishedPostSource('linkedin', async () => [{ id: 'a', urn: 'urn:li:share:1', title: 'A' }])
    const offB = registerPublishedPostSource('linkedin', async () => [{ id: 'b', urn: 'urn:li:share:2', title: 'B' }])
    expect((await publishedPosts('linkedin')).map((p) => p.id)).toEqual(['a', 'b'])
    offA()
    expect((await publishedPosts('linkedin')).map((p) => p.id)).toEqual(['b'])
    offB()
    expect(await publishedPosts('substack')).toEqual([])
  })
})
