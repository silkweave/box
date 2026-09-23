import { expect, test } from 'bun:test'
import { whilePageActive } from '../src/lib/pageLifecycle.ts'

test('navigation releases all feeds and history restore reconnects once without React remounting', () => {
  const page = new EventTarget()
  let open = 0
  let connections = 0
  const dispose = Array.from({ length: 3 }, () => whilePageActive(() => {
    open++
    connections++
    return () => { open-- }
  }, page))
  expect(open).toBe(3)
  page.dispatchEvent(new Event('pageshow'))
  expect(connections).toBe(3)
  page.dispatchEvent(new Event('pagehide'))
  expect(open).toBe(0)
  page.dispatchEvent(new Event('pagehide'))
  expect(open).toBe(0)
  page.dispatchEvent(new Event('pageshow'))
  expect(open).toBe(3)
  expect(connections).toBe(6)
  dispose.forEach(stop => stop())
  expect(open).toBe(0)
  page.dispatchEvent(new Event('pageshow'))
  expect(open).toBe(0)
})
