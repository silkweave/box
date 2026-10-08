import { describe, expect, it } from 'vitest'
import { detectProviderProfiles, setupProfilePatch, type ProviderCandidate } from './setup.js'

const candidate = (engine: 'codex' | 'claude', home = `/profiles/${engine}`): ProviderCandidate => ({
  engine,
  home,
  authenticated: true,
  source: 'default',
})

describe('first-run setup', () => {
  it('detects conventional and environment-selected provider homes without reading credentials', () => {
    const directories = new Set(['/home/alice/.codex', '/profiles/claude'])
    const files = new Set(['/home/alice/.codex/auth.json'])
    expect(detectProviderProfiles({
      home: '/home/alice',
      env: { CLAUDE_CONFIG_DIR: '/profiles/claude' },
      directory: path => directories.has(path),
      exists: path => files.has(path),
    })).toEqual([
      { engine: 'codex', home: '/home/alice/.codex', authenticated: true, source: 'default' },
      { engine: 'claude', home: '/profiles/claude', authenticated: false, source: 'environment' },
    ])
  })

  it('adds owner profiles while preserving existing WorkerDeck configuration', () => {
    const patch = setupProfilePatch({
      workerdeck: {
        profiles: [{ name: 'assistant:codex', engine: 'codex', person: 'assistant', home: '/service/.codex' }],
        cwdRoots: ['/box'],
      },
      agentProfiles: { assistant: { codex: 'assistant:codex' } },
    }, 'admin', [candidate('codex'), candidate('claude')])

    expect(patch).toMatchObject({
      workerdeck: {
        cwdRoots: ['/box'],
        profiles: [
          { name: 'assistant:codex' },
          { name: 'admin:codex', engine: 'codex', person: 'admin', home: '/profiles/codex', defaults: { permissionMode: 'acceptEdits' } },
          { name: 'admin:claude', engine: 'claude', person: 'admin', home: '/profiles/claude' },
        ],
      },
      agentProfiles: { admin: { codex: 'admin:codex', claude: 'admin:claude' } },
    })
  })

  it('does not silently replace an existing owner mapping', () => {
    expect(() => setupProfilePatch({
      workerdeck: null,
      agentProfiles: { admin: { codex: 'custom-profile' } },
    }, 'admin', [candidate('codex')])).toThrow(/will not replace/)
  })

  it('does not silently replace an existing profile or malformed profile list', () => {
    expect(() => setupProfilePatch({
      workerdeck: { profiles: [{ name: 'admin:codex', engine: 'codex', person: 'someone-else', home: '/custom' }] },
      agentProfiles: {},
    }, 'admin', [candidate('codex')])).toThrow(/different settings/)
    expect(() => setupProfilePatch({
      workerdeck: { profiles: 'not-a-list' },
      agentProfiles: {},
    }, 'admin', [candidate('codex')])).toThrow(/not an array/)
  })
})
