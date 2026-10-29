import { describe, expect, test } from 'bun:test'
import { landingAt } from '../src/presets/boardView.ts'

describe('landingAt', () => {
  const tasks = [
    { path: '/tasks', preset: 'Open tasks' },
    { path: '/tasks/*', preset: 'Open tasks' },
  ]

  test('an exact path lands on itself only', () => {
    expect(landingAt({ path: '/tasks', preset: 'Open tasks' }, '/tasks')?.path).toBe('/tasks')
    expect(landingAt({ path: '/tasks', preset: 'Open tasks' }, '/tasks/launch/press-kit')).toBeUndefined()
  })

  test('a /* path covers everything below it, not itself or a sibling prefix', () => {
    const below = { path: '/tasks/*', preset: 'Open tasks' }
    expect(landingAt(below, '/tasks/launch/press-kit')?.path).toBe('/tasks/*')
    expect(landingAt(below, '/tasks/~/renew-domain')?.path).toBe('/tasks/*')
    expect(landingAt(below, '/tasks')).toBeUndefined()
    expect(landingAt(below, '/tasksx/a')).toBeUndefined()
  })

  test('the tasks pair covers the board and its item addresses; no landing elsewhere', () => {
    expect(landingAt(tasks, '/tasks')?.preset).toBe('Open tasks')
    expect(landingAt(tasks, '/tasks/launch/press-kit')?.preset).toBe('Open tasks')
    expect(landingAt(tasks, '/initiatives')).toBeUndefined()
    expect(landingAt(undefined, '/tasks')).toBeUndefined()
  })
})
