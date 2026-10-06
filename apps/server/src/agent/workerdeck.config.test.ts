import { describe, expect, it } from 'vitest'
import { DEFAULT_QUEUE, parseWorkerdeckConfig } from './workerdeck.config.js'

const ctx = (existing: string[] = []) => ({
  repoRoot: '/repo',
  homeExists: (p: string) => existing.includes(p),
})

const profile = (over: Record<string, unknown> = {}) => ({
  name: 'alice:claude',
  engine: 'claude',
  person: 'alice',
  home: '/home/alice/.claude',
  ...over,
})

describe('parseWorkerdeckConfig', () => {
  it('reads a minimal file and defaults the machine facts', () => {
    const config = parseWorkerdeckConfig({ profiles: [profile()] }, ctx(['/home/alice/.claude']))
    expect(config.profiles).toHaveLength(1)
    expect(config.pending).toEqual([])
    expect(config.cwdRoots).toEqual(['/repo'])
    expect(config.stateDir).toMatch(/agent$/)
    expect(config.claudeTokens).toBe(false)
    expect(config.queue).toEqual(DEFAULT_QUEUE)
  })

  it('splits a profile whose home does not exist into `pending` rather than refusing', () => {
    // One teammate who has not logged in yet must never be an outage for the others: an undeclared
    // profile is a boot the rest of the team still gets, a declared one with a missing home is a
    // hard createWorkerServer failure that takes the whole agent surface down.
    const config = parseWorkerdeckConfig(
      { profiles: [profile(), profile({ name: 'bob:claude', person: 'bob', home: '/home/bob/.claude' })] },
      ctx(['/home/alice/.claude']),
    )
    expect(config.profiles.map((p) => p.name)).toEqual(['alice:claude'])
    expect(config.pending.map((p) => p.name)).toEqual(['bob:claude'])
  })

  it('ignores `_`-prefixed doc notes at both levels', () => {
    const config = parseWorkerdeckConfig(
      { _readme: ['anything'], profiles: [profile({ _comment: 'why this one exists' })] },
      ctx(['/home/alice/.claude']),
    )
    expect(config.profiles).toHaveLength(1)
  })

  it('carries defaults and the per-profile MCP token path through', () => {
    const config = parseWorkerdeckConfig(
      {
        profiles: [
          profile({
            engine: 'codex',
            home: '/home/alice/.codex',
            defaults: { model: 'a-model', permissionMode: 'acceptEdits' },
            mcpTokensPath: '/home/alice/.codex/mcp-tokens.env',
          }),
        ],
      },
      ctx(['/home/alice/.codex']),
    )
    expect(config.profiles[0]?.defaults).toEqual({ model: 'a-model', permissionMode: 'acceptEdits' })
    expect(config.profiles[0]?.mcpTokensPath).toBe('/home/alice/.codex/mcp-tokens.env')
  })

  it('honours explicit cwdRoots, stateDir and claudeTokens', () => {
    const config = parseWorkerdeckConfig(
      { profiles: [profile()], cwdRoots: ['/srv/box'], stateDir: '/srv/state', claudeTokens: true },
      ctx(['/home/alice/.claude']),
    )
    expect(config.cwdRoots).toEqual(['/srv/box'])
    expect(config.stateDir).toBe('/srv/state')
    expect(config.claudeTokens).toBe(true)
  })

  // Every case below is the file's load-bearing property: a mistake here must be a FAILED BOOT of
  // the agent surface, never a quietly smaller set of profiles that looks like it worked.
  it.each([
    ['a non-object file', 'nope'],
    ['no profiles array', {}],
    ['a profiles value that is not an array', { profiles: {} }],
    ['a profile that is not an object', { profiles: ['alice'] }],
    ['an unknown engine', { profiles: [profile({ engine: 'gemini' })] }],
    ['a missing name', { profiles: [profile({ name: undefined })] }],
    ['a blank person', { profiles: [profile({ person: '  ' })] }],
    ['a missing home', { profiles: [profile({ home: undefined })] }],
    ['an unknown key (a typo must not be silently dropped)', { profiles: [profile({ hoem: '/x' })] }],
    ['a non-object defaults', { profiles: [profile({ defaults: 'acceptEdits' })] }],
    ['a non-string cwdRoots entry', { profiles: [profile()], cwdRoots: [1] }],
    ['a non-boolean claudeTokens', { profiles: [profile()], claudeTokens: 'yes' }],
    ['a non-object queue', { profiles: [profile()], queue: 2 }],
    ['an unknown queue key', { profiles: [profile()], queue: { maxConcurency: 2 } }],
    ['a zero queue concurrency', { profiles: [profile()], queue: { maxConcurrency: 0 } }],
    ['a fractional token limit', { profiles: [profile()], queue: { sessionTokenLimit: 1.5 } }],
    ['bypassPermissions for unattended runs', { profiles: [profile()], queue: { permissionMode: 'bypassPermissions' } }],
    ['an unattended mode other than auto or dontAsk', { profiles: [profile()], queue: { permissionMode: 'acceptEdits' } }],
  ])('refuses %s', (_why, raw) => {
    expect(() => parseWorkerdeckConfig(raw, ctx(['/home/alice/.claude']))).toThrow(/box\.json workerdeck/)
  })

  it('reads the job queue settings, keeping defaults for what is not named', () => {
    const config = parseWorkerdeckConfig(
      { profiles: [profile()], queue: { maxConcurrency: 2, dailyTokenLimit: 5_000_000, sessionTokenLimit: null, permissionMode: 'dontAsk' } },
      ctx(['/home/alice/.claude']),
    )
    expect(config.queue).toEqual({ ...DEFAULT_QUEUE, maxConcurrency: 2, dailyTokenLimit: 5_000_000, permissionMode: 'dontAsk' })
    expect(DEFAULT_QUEUE.permissionMode).toBe('auto')
  })

  it('refuses a duplicate profile name', () => {
    // Two declarations of one name is ambiguous about which config dir a session runs under, and
    // the worker would silently take one of them.
    expect(() =>
      parseWorkerdeckConfig({ profiles: [profile(), profile({ home: '/home/other/.claude' })] }, ctx()),
    ).toThrow(/duplicate profile name/)
  })
})
