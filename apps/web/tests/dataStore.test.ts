import { describe, expect, test } from 'bun:test'
import { dispatch, registerStoreReloads } from '../src/lib/changeFeed'
import { createDataStore } from '../src/lib/dataStore'

interface Deferred<T> {
  promise: Promise<T>
  resolve(v: T): void
  reject(e: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function tracked(): { calls: Array<Deferred<string>>; fetcher: () => Promise<string> } {
  const calls: Array<Deferred<string>> = []
  return {
    calls,
    fetcher: () => {
      const d = deferred<string>()
      calls.push(d)
      return d.promise
    },
  }
}

describe('createDataStore invalidation', () => {
  test('a pre-policy read resolving after a forced reload never refills the cache', async () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    const first = store.load()
    const reload = store.reload()
    expect(calls.length).toBe(2)
    calls[1].resolve('post')
    await reload
    calls[0].resolve('pre')
    await first
    expect(store.peek()).toBe('post')
  })

  test('a pre-policy read resolving after a refused post-policy reload leaves the cache empty', async () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    const first = store.load()
    const refused = store.reload().catch((e: unknown) => String(e))
    expect(calls.length).toBe(2)
    calls[1].reject(new Error('403 forbidden'))
    expect(await refused).toContain('403')
    store.clear()
    calls[0].resolve('pre')
    await first.catch(() => undefined)
    expect(store.peek()).toBeNull()
  })

  test('a pre-policy read resolving after clear() does not refill the cache', async () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    const first = store.load()
    store.clear()
    calls[0].resolve('pre')
    await first
    expect(store.peek()).toBeNull()
  })

  test('a plain load still dedupes against an in-flight request', async () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    const a = store.load()
    const b = store.load()
    calls[0].resolve('x')
    expect(await a).toBe('x')
    expect(await b).toBe('x')
    expect(calls.length).toBe(1)
  })
})

describe('policy events and a pending first load', () => {
  test('a policy event during the first load invalidates it and reloads fresh', async () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    registerStoreReloads(['policy'], store)
    const first = store.load()
    dispatch({ seq: 1, ts: '2026-11-10T00:00:00Z', scope: 'policy', detail: null })
    expect(calls.length).toBe(2)
    calls[1].reject(Object.assign(new Error('forbidden'), { status: 403 }))
    await new Promise((r) => setTimeout(r, 0))
    calls[0].resolve('pre')
    await first.catch(() => undefined)
    expect(store.peek()).toBeNull()
  })

  test('a store never loaded is not fetched by a policy event', () => {
    const { calls, fetcher } = tracked()
    const store = createDataStore<string>(fetcher)
    registerStoreReloads(['policy'], store)
    dispatch({ seq: 2, ts: '2026-11-10T00:00:00Z', scope: 'policy', detail: null })
    expect(calls.length).toBe(0)
  })
})
