import { describe, expect, test } from 'bun:test'
import { createRouteShellStore, selectRouteChrome } from '../src/lib/routeShellStore.ts'

describe('route shell store', () => {
  test('a new owner replaces the previous owner and delayed cleanup cannot erase it', () => {
    const store = createRouteShellStore<string>()
    const outgoing = Symbol('outgoing')
    const incoming = Symbol('incoming')

    store.publish(outgoing, '/chat', 'first:/chat', 'old chrome')
    store.publish(incoming, '/notes', 'second:/notes', 'new chrome')
    store.remove(outgoing)

    expect(store.getSnapshot()).toEqual({
      owner: incoming,
      section: '/notes',
      location: 'second:/notes',
      value: 'new chrome',
    })
  })

  test('selection requires both the owning section and committed location', () => {
    const store = createRouteShellStore<string>()
    store.publish(Symbol('notes'), '/notes', 'visit-1:/notes/launch', 'launch chrome')
    const snapshot = store.getSnapshot()

    expect(selectRouteChrome(snapshot, '/notes', 'visit-1:/notes/launch')).toBe('launch chrome')
    expect(selectRouteChrome(snapshot, '/chat', 'visit-1:/notes/launch')).toBeUndefined()
    expect(selectRouteChrome(snapshot, '/notes', 'visit-2:/notes/launch')).toBeUndefined()
    expect(selectRouteChrome(snapshot, '/notes', 'visit-1:/notes/other')).toBeUndefined()
  })

  test('same-section publication replaces callbacks and releases the previous descriptor', () => {
    const store = createRouteShellStore<{ select: () => string }>()
    const owner = Symbol('section')
    const oldChrome = { select: () => 'old record' }
    const newChrome = { select: () => 'new record' }
    store.publish(owner, '/chat', 'first:/chat/old', oldChrome)
    store.publish(owner, '/chat', 'second:/chat/new', newChrome)

    expect(selectRouteChrome(store.getSnapshot(), '/chat', 'first:/chat/old')).toBeUndefined()
    expect(selectRouteChrome(store.getSnapshot(), '/chat', 'second:/chat/new')?.select()).toBe('new record')
    expect(store.getSnapshot()?.value).toBe(newChrome)
    store.remove(owner)
    expect(store.getSnapshot()).toBeNull()
  })

  test('getSnapshot keeps one identity until the store changes', () => {
    const store = createRouteShellStore<{ label: string }>()
    const owner = Symbol('owner')
    const value = { label: 'Chat' }

    store.publish(owner, '/chat', 'visit:/chat', value)
    const published = store.getSnapshot()
    expect(store.getSnapshot()).toBe(published)
    expect(published?.value).toBe(value)

    store.publish(owner, '/chat', 'visit:/chat', value)
    expect(store.getSnapshot()).not.toBe(published)
  })

  test('removal is owner-scoped and idempotent', () => {
    const store = createRouteShellStore<string>()
    const owner = Symbol('owner')
    let notifications = 0
    store.subscribe(() => notifications++)
    store.publish(owner, '/settings', 'visit:/settings', 'settings chrome')

    store.remove(Symbol('stranger'))
    expect(notifications).toBe(1)
    expect(store.getSnapshot()?.value).toBe('settings chrome')

    store.remove(owner)
    expect(notifications).toBe(2)
    expect(store.getSnapshot()).toBeNull()

    store.remove(owner)
    expect(notifications).toBe(2)
  })

  test('disposing a subscription stops future notifications', () => {
    const store = createRouteShellStore<string>()
    let activeNotifications = 0
    let disposedNotifications = 0
    const dispose = store.subscribe(() => disposedNotifications++)
    store.subscribe(() => activeNotifications++)

    dispose()
    store.publish(Symbol('owner'), '/', 'visit:/', 'dashboard chrome')

    expect(disposedNotifications).toBe(0)
    expect(activeNotifications).toBe(1)
  })
})
