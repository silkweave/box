import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('preserves WorkerDeck compact replay flags through the Builder browser client', async () => {
  const urls: string[] = []
  vi.stubGlobal('location', { protocol: 'https:', host: 'box.example' })
  vi.stubGlobal('WebSocket', class { constructor(url: string) { urls.push(url) } })
  // Load the browser client at runtime without pulling DOM globals into the server typecheck.
  const browserModule = new URL('../../../web/src/lib/builderStore.ts', import.meta.url).pathname
  const { builderClient } = await import(browserModule)
  builderClient.openSocket('session/one', 768, true, true)
  const url = new URL(urls[0])
  expect(url.origin).toBe('wss://box.example')
  expect(url.pathname).toBe('/builder-agent/v1/sessions/session%2Fone/ws')
  expect(Object.fromEntries(url.searchParams)).toEqual({ afterSeq: '768', truncateResults: '1', imageRefs: '1' })
})
