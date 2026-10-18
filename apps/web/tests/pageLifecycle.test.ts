import { expect, test } from 'bun:test'
import { whilePageActive, type PageSignals } from '../src/lib/pageLifecycle.ts'

class FakeView extends EventTarget {
  hidden = false
  set(hidden: boolean): void {
    this.hidden = hidden
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

const GRACE_MS = 10
const afterGrace = () => Bun.sleep(GRACE_MS * 4)

function track(signals: PageSignals, feeds = 3) {
  const state = { open: 0, connections: 0 }
  const dispose = Array.from({ length: feeds }, () => whilePageActive(() => {
    state.open++
    state.connections++
    return () => { state.open-- }
  }, signals))
  return { state, dispose: () => dispose.forEach(stop => stop()) }
}

test('navigation releases all feeds and history restore reconnects once without React remounting', () => {
  const page = new EventTarget()
  const { state, dispose } = track({ page, view: new FakeView(), graceMs: GRACE_MS })
  expect(state.open).toBe(3)
  page.dispatchEvent(new Event('pageshow'))
  expect(state.connections).toBe(3)
  page.dispatchEvent(new Event('pagehide'))
  expect(state.open).toBe(0)
  page.dispatchEvent(new Event('pagehide'))
  expect(state.open).toBe(0)
  page.dispatchEvent(new Event('pageshow'))
  expect(state.open).toBe(3)
  expect(state.connections).toBe(6)
  dispose()
  expect(state.open).toBe(0)
  page.dispatchEvent(new Event('pageshow'))
  expect(state.open).toBe(0)
})

test('a tab hidden past the grace period releases its feeds and reconnects when shown', async () => {
  const view = new FakeView()
  const { state, dispose } = track({ page: new EventTarget(), view, graceMs: GRACE_MS })
  view.set(true)
  expect(state.open).toBe(3)
  await afterGrace()
  expect(state.open).toBe(0)
  view.set(true)
  await afterGrace()
  expect(state.open).toBe(0)
  view.set(false)
  expect(state.open).toBe(3)
  expect(state.connections).toBe(6)
  dispose()
  expect(state.open).toBe(0)
})

test('a short tab switch keeps the feeds connected', async () => {
  const view = new FakeView()
  const { state, dispose } = track({ page: new EventTarget(), view, graceMs: GRACE_MS })
  view.set(true)
  view.set(false)
  await afterGrace()
  expect(state.open).toBe(3)
  expect(state.connections).toBe(3)
  dispose()
})

test('a tab opened in the background connects, then releases after the grace period', async () => {
  const view = new FakeView()
  view.hidden = true
  const { state, dispose } = track({ page: new EventTarget(), view, graceMs: GRACE_MS })
  expect(state.open).toBe(3)
  await afterGrace()
  expect(state.open).toBe(0)
  view.set(false)
  expect(state.open).toBe(3)
  dispose()
})

test('a history restore into a hidden tab waits until the tab is shown', async () => {
  const page = new EventTarget()
  const view = new FakeView()
  const { state, dispose } = track({ page, view, graceMs: GRACE_MS })
  page.dispatchEvent(new Event('pagehide'))
  view.hidden = true
  page.dispatchEvent(new Event('pageshow'))
  expect(state.open).toBe(0)
  view.set(false)
  expect(state.open).toBe(3)
  dispose()
})

test('disposing while hidden cancels the pending release', async () => {
  const view = new FakeView()
  const { state, dispose } = track({ page: new EventTarget(), view, graceMs: GRACE_MS })
  view.set(true)
  dispose()
  expect(state.open).toBe(0)
  await afterGrace()
  view.set(false)
  expect(state.open).toBe(0)
  expect(state.connections).toBe(3)
})
