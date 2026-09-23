import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveStackSource } from './stack-source.js'

const ROOT = '/work/box'

test('paths resolve against the Box root or the home directory', () => {
  expect(resolveStackSource('..', ROOT)).toEqual({ kind: 'path', path: '/work' })
  expect(resolveStackSource('.', ROOT)).toEqual({ kind: 'path', path: ROOT })
  expect(resolveStackSource('../stack', ROOT)).toEqual({ kind: 'path', path: '/work/stack' })
  expect(resolveStackSource('./vendor/stack', ROOT)).toEqual({ kind: 'path', path: '/work/box/vendor/stack' })
  expect(resolveStackSource('/srv/stack', ROOT)).toEqual({ kind: 'path', path: '/srv/stack' })
  expect(resolveStackSource('~', ROOT)).toEqual({ kind: 'path', path: homedir() })
  expect(resolveStackSource('~/src/stack', ROOT)).toEqual({ kind: 'path', path: join(homedir(), 'src/stack') })
})

test('GitHub shorthand always means GitHub, and git URLs pass through', () => {
  expect(resolveStackSource('silkweave/stack', ROOT)).toEqual({ kind: 'git', url: 'https://github.com/silkweave/stack.git' })
  expect(resolveStackSource('silkweave/stack.git', ROOT)).toEqual({ kind: 'git', url: 'https://github.com/silkweave/stack.git' })
  for (const url of ['https://example.com/o/r.git', 'ssh://git@example.com/o/r.git', 'git@github.com:silkweave/stack.git', 'file:///srv/stack']) {
    expect(resolveStackSource(url, ROOT)).toEqual({ kind: 'git', url })
  }
})

test('anything else is refused with the accepted forms named', () => {
  expect(() => resolveStackSource('stack', ROOT)).toThrow(/not GitHub owner\/repo, a git URL or a path/)
})
