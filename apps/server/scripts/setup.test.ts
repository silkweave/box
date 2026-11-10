import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineUnavailable } from '@silkweave/box-core/db/engines'
import { boxProfile, chooseProfiles, createBoxProfileHomes, detectProviderProfiles, ensureDatabaseHost, setupProfilePatch, startsDev, suggestOwner, type ProviderCandidate } from './setup.js'

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

  it('defaults to a Box-only Claude profile and reuses an existing dir only when asked', () => {
    const existing = [candidate('claude', '/home/alice/.claude'), candidate('codex', '/home/alice/.codex')]
    expect(chooseProfiles({}, existing, '/box', 'admin')).toEqual([
      { engine: 'claude', home: '/box/data/agent/accounts/admin/claude', authenticated: false, source: 'box' },
    ])
    expect(chooseProfiles({ profiles: ['claude', 'codex'] }, existing, '/box', 'admin').map(p => p.home)).toEqual([
      '/box/data/agent/accounts/admin/claude',
      '/box/data/agent/accounts/admin/codex',
    ])
    expect(chooseProfiles({ existing: ['claude'] }, existing, '/box', 'admin').map(p => p.home)).toEqual(['/home/alice/.claude'])
    expect(chooseProfiles({ profiles: ['codex'], existing: ['claude'] }, existing, '/box', 'admin').map(p => p.home)).toEqual([
      '/box/data/agent/accounts/admin/codex',
      '/home/alice/.claude',
    ])
    expect(chooseProfiles({ noProfiles: true }, existing, '/box', 'admin')).toEqual([])
    expect(() => chooseProfiles({ existing: ['codex'] }, [], '/box', 'admin')).toThrow(/no existing config directory/)
  })

  it('creates Box-only config dirs readable by the owner only and leaves existing dirs alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'box-setup-'))
    try {
      createBoxProfileHomes([boxProfile(root, 'admin', 'claude'), candidate('codex', join(root, 'elsewhere'))])
      const home = join(root, 'data/agent/accounts/admin/claude')
      expect(statSync(home).mode & 0o777).toBe(0o700)
      expect(statSync(join(root, 'data/agent/accounts/admin')).mode & 0o777).toBe(0o700)
      expect(() => statSync(join(root, 'elsewhere'))).toThrow()
      const patch = setupProfilePatch({ workerdeck: null, agentProfiles: {} }, 'admin', [boxProfile(root, 'admin', 'claude')])
      expect(patch).toMatchObject({ workerdeck: { profiles: [{ name: 'admin:claude', engine: 'claude', person: 'admin', home }] } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('suggests the owner from the computer account, falling back to admin', () => {
    expect(suggestOwner('mark', 'Mark Smith', 'stella')).toEqual({ id: 'mark', name: 'Mark Smith' })
    expect(suggestOwner('Mark.Smith', undefined, 'stella')).toEqual({ id: 'mark-smith', name: 'mark-smith' })
    expect(suggestOwner('stella', 'Stella', 'stella')).toEqual({ id: 'admin', name: 'Stella' })
    expect(suggestOwner('root', '', 'stella')).toEqual({ id: 'admin', name: 'admin' })
    expect(suggestOwner('___', undefined, 'stella').id).toBe('admin')
  })

  it('hands over to box dev only in an interactive terminal without --yes or --no-start', () => {
    expect(startsDev({ yes: false, noStart: false }, true)).toBe(true)
    expect(startsDev({ yes: true, noStart: false }, true)).toBe(false)
    expect(startsDev({ yes: false, noStart: true }, true)).toBe(false)
    expect(startsDev({ yes: false, noStart: false }, false)).toBe(false)
  })
})

describe('database host packages', () => {
  const tools = { binDir: '/x', version: '18.1', major: 18 }
  const fake = (state: { native: boolean; tools: boolean }, manager = true) => {
    const ran: string[][] = []
    return {
      ran,
      deps: {
        resolveNative: () => { if (!state.native) throw new EngineUnavailable('no native', 'install native'); return {} as never },
        resolveClientTools: () => { if (!state.tools) throw new EngineUnavailable('no tools', 'install tools'); return tools },
        hostInstallCommand: (what: 'native' | 'client-tools') => (manager ? ['pkg', 'install', what] : null),
        install: (cmd: string[]) => { ran.push(cmd); if (cmd[2] === 'native') { state.native = true; state.tools = true } else state.tools = true; return 0 },
      },
    }
  }

  it('does nothing when everything is present', async () => {
    const f = fake({ native: true, tools: true })
    expect(await ensureDatabaseHost('native', async () => { throw new Error('asked') }, f.deps)).toEqual([])
    expect(f.ran).toEqual([])
  })

  it('installs only after the owner agrees, and native brings the client tools', async () => {
    const f = fake({ native: false, tools: false })
    const asked: string[] = []
    const done = await ensureDatabaseHost('native', async (q) => { asked.push(q); return true }, f.deps)
    expect(f.ran).toEqual([['pkg', 'install', 'native']])
    expect(asked).toHaveLength(1)
    expect(done).toEqual(['PostgreSQL 18 with pgvector'])
  })

  it('pgrust needs only the client tools', async () => {
    const f = fake({ native: false, tools: false })
    await ensureDatabaseHost('pgrust', async () => true, f.deps)
    expect(f.ran).toEqual([['pkg', 'install', 'client-tools']])
  })

  it('stops with the install hint when declined or without a package manager', async () => {
    const declined = fake({ native: true, tools: false })
    await expect(ensureDatabaseHost('pgrust', async () => false, declined.deps)).rejects.toThrow(/install tools/)
    expect(declined.ran).toEqual([])
    const none = fake({ native: true, tools: false }, false)
    await expect(ensureDatabaseHost('pgrust', async () => true, none.deps)).rejects.toThrow(/install tools/)
  })

  it('fails with the hint when the install command fails', async () => {
    const f = fake({ native: true, tools: false })
    f.deps.install = () => 1
    await expect(ensureDatabaseHost('pgrust', async () => true, f.deps)).rejects.toThrow(/pkg install client-tools failed \(exit 1\)[\s\S]*install tools/)
  })
})
