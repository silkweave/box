import { describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

const fake = vi.hoisted(() => {
  const calls: Array<{ name: string; args: unknown[] }> = []
  let status: 'idle' | 'running' | 'failed' | 'closed' = 'idle'
  let lastSeq = 0
  const listeners = new Set<(event: { type: string; status?: string; seq: number }) => void>()
  const runner = {
    id: 'session-1',
    info: () => ({ id: 'session-1', profile: 'alice:codex', engine: 'codex', status, lastSeq }),
    subscribe: (listener: (event: { type: string; status?: string; seq: number }) => void, afterSeq?: number) => {
      if (afterSeq !== undefined && afterSeq > lastSeq) throw new Error('subscription cannot start in the future')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sendMessage: (...args: unknown[]) => { calls.push({ name: 'sendMessage', args }) },
    resolvePermission: (...args: unknown[]) => { calls.push({ name: 'resolvePermission', args }); return true },
    interrupt: async () => { calls.push({ name: 'interrupt', args: [] }) },
    clearContext: async () => { calls.push({ name: 'clearContext', args: [] }) },
    setPermissionMode: async (...args: unknown[]) => { calls.push({ name: 'setPermissionMode', args }) },
    setModel: async (...args: unknown[]) => { calls.push({ name: 'setModel', args }) },
  }
  const worker = {
    listen: async () => ({ port: 12345 }),
    registry: { get: (id: string) => id === 'session-1' ? runner : undefined },
    parking: { ensureLive: async () => undefined, listInfo: async () => [] },
  }
  return {
    calls, runner, worker,
    setStatus(next: typeof status) { status = next; lastSeq += 1; for (const listener of listeners) listener({ type: 'status_changed', status: next, seq: lastSeq }) },
    reset() { status = 'idle'; lastSeq = 0; listeners.clear() },
  }
})

vi.mock('@silkweave/box-core', () => ({
  boxJson: () => ({ agentProfiles: { alice: { codex: 'alice:codex', claude: 'alice:claude' } } }),
}))
vi.mock('../agent/workerdeck.config.js', () => ({
  readWorkerdeckConfig: () => ({
    profiles: [
      { name: 'alice:codex', engine: 'codex', person: 'alice', home: '/codex' },
      { name: 'alice:claude', engine: 'claude', person: 'alice', home: join(homedir(), '.claude') },
    ],
    pending: [], cwdRoots: ['/box'], stateDir: '/box/data/agent',
  }),
}))
vi.mock('@workerdeck/server', () => ({
  createFileSessionStore: () => ({}),
  createWorkerServer: vi.fn(() => fake.worker),
}))

const { createBuilderHost } = await import('./builder-host.js')

describe('Builder host command dispatch', () => {
  it('passes an explicit configDir even for the default Claude home', async () => {
    const { createWorkerServer } = await import('@workerdeck/server')
    await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
    expect(createWorkerServer).toHaveBeenLastCalledWith(expect.objectContaining({
      profiles: expect.arrayContaining([expect.objectContaining({
        name: 'alice:claude', engine: 'claude', configDir: join(homedir(), '.claude'),
      })]),
    }))
    const options = vi.mocked(createWorkerServer).mock.calls.at(-1)?.[0]
    const config = options?.buildRunnerConfig?.({ cwd: '/box', profile: 'alice:codex' })
    if (typeof config?.instructions !== 'function') throw new Error('Builder instructions are not configured')
    const instructions = config.instructions({ sessionId: 'session-42' })
    expect(instructions).toContain('box builder browser --session session-42 snapshot')
    expect(instructions).toContain('box app restart')
    expect(instructions).toContain('Never stop, kill, replace, or relaunch it')
    expect(instructions).toContain('box app promote only when the owner asks')
  })

  it('starts in auto mode when available and falls back to accept edits', async () => {
    const modes = [['auto', 'acceptEdits'], ['acceptEdits']]
    const requests: Array<Record<string, unknown>> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname
      if (path === '/v1/profiles') {
        return new Response(JSON.stringify({ profiles: [{ name: 'alice:codex', engine: 'codex', capabilities: { permissionModes: modes[requests.length] } }] }), { status: 200 })
      }
      if (path === '/v1/sessions' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ session: { id: `created-${requests.length}`, status: 'idle', cwd: '/box', createdAt: 1, lastSeq: 0, pendingPermissionCount: 0 } }), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
      await host.create('alice', 'codex')
      await host.create('alice', 'codex')
      expect(requests.map(request => request.permissionMode)).toEqual(['auto', 'acceptEdits'])
      expect(requests.map(request => request.model)).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('starts claude on opus unless the profile declares a default model', async () => {
    const requests: Array<Record<string, unknown>> = []
    const profiles = [
      [{ name: 'alice:claude', engine: 'claude' }],
      [{ name: 'alice:claude', engine: 'claude', defaults: { model: 'sonnet' } }],
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname
      if (path === '/v1/profiles') return new Response(JSON.stringify({ profiles: profiles[requests.length] }), { status: 200 })
      if (path === '/v1/sessions' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ session: { id: `created-${requests.length}`, status: 'idle', cwd: '/box', createdAt: 1, lastSeq: 0, pendingPermissionCount: 0 } }), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    }))
    try {
      const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
      await host.create('alice', 'claude')
      await host.create('alice', 'claude')
      expect(requests.map(request => request.model)).toEqual(['opus[1m]', 'sonnet'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('starts claude when no engine is requested and both are configured', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname
      if (path === '/v1/profiles') return new Response(JSON.stringify({ profiles: [{ name: 'alice:codex', engine: 'codex' }, { name: 'alice:claude', engine: 'claude' }] }), { status: 200 })
      if (path === '/v1/sessions' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ session: { id: 'created-1', status: 'idle', cwd: '/box', createdAt: 1, lastSeq: 0, pendingPermissionCount: 0 } }), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    }))
    try {
      const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
      await host.create('alice')
      expect(requests.map(request => [request.profile, request.model])).toEqual([['alice:claude', 'opus[1m]']])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('dispatches only supported commands directly to the runner', async () => {
    fake.calls.length = 0
    fake.reset()
    const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
    await host.command('session-1', { type: 'user_message', text: 'hello' })
    await host.command('session-1', { type: 'permission_decision', requestId: 'p1', behavior: 'allow', updatedInput: { answer: 'yes' } })
    await host.command('session-1', { type: 'interrupt' })
    await host.command('session-1', { type: 'clear_context' })
    await host.command('session-1', { type: 'set_permission_mode', mode: 'acceptEdits' })
    await host.command('session-1', { type: 'set_model', model: 'gpt-test' })
    expect(fake.calls).toEqual([
      { name: 'sendMessage', args: ['hello'] },
      { name: 'resolvePermission', args: ['p1', { behavior: 'allow', updatedInput: { answer: 'yes' } }] },
      { name: 'interrupt', args: [] },
      { name: 'clearContext', args: [] },
      { name: 'setPermissionMode', args: ['acceptEdits'] },
      { name: 'setModel', args: ['gpt-test'] },
    ])
  })

  it('keeps an idle queued turn pending until a real status event proves activity', async () => {
    fake.calls.length = 0
    fake.reset()
    const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
    await host.command('session-1', { type: 'user_message', text: 'queued' })
    expect(host.hasPendingWork('session-1')).toBe(true)
    fake.setStatus('idle')
    expect(host.hasPendingWork('session-1')).toBe(true)
    fake.setStatus('running')
    expect(host.hasPendingWork('session-1')).toBe(false)
    await host.command('session-1', { type: 'user_message', text: 'running now' })
    expect(host.hasPendingWork('session-1')).toBe(false)
  })

  it('handles /clear without queuing a model turn and rejects blank messages', async () => {
    fake.calls.length = 0
    fake.reset()
    const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
    await host.command('session-1', { type: 'user_message', text: '/clear' })
    expect(fake.calls).toEqual([{ name: 'clearContext', args: [] }])
    await expect(host.command('session-1', { type: 'user_message', text: '   ' })).rejects.toThrow(/non-empty text or an attachment/)
  })

  it('resolves uploaded attachment ids from the worker before sending the turn', async () => {
    fake.calls.length = 0
    fake.reset()
    const fetch = vi.fn(async (url: string) => url.endsWith('/attachments/img-1')
      ? new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('shot 1.png')}` } })
      : new Response(JSON.stringify({ error: 'attachment not found' }), { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    try {
      const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
      await expect(host.command('session-1', { type: 'user_message', text: 'look', attachmentIds: ['missing'] })).rejects.toThrow(/not available/)
      expect(fake.calls).toEqual([])
      expect(host.hasPendingWork('session-1')).toBe(false)
      await host.command('session-1', { type: 'user_message', text: '', attachmentIds: ['img-1'] })
      expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/\/v1\/sessions\/session-1\/attachments\/img-1$/)
      expect(fake.calls).toEqual([{ name: 'sendMessage', args: ['', [{ id: 'img-1', name: 'shot 1.png', mediaType: 'image/png', bytes: 9, data: Buffer.from('png-bytes').toString('base64') }]] }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects inline attachments, bypass mode, shell, close, tool bridge, and malformed permission input', async () => {
    const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
    await expect(host.command('session-1', { type: 'user_message', text: 'hello', attachments: [{ data: 'x' }] })).rejects.toThrow(/attachmentIds/)
    await expect(host.command('session-1', { type: 'user_message', text: 'hello', attachmentIds: [42] })).rejects.toThrow(/attachment ids/)
    await expect(host.command('session-1', { type: 'set_permission_mode', mode: 'bypassPermissions' })).rejects.toThrow(/unsupported/)
    await expect(host.command('session-1', { type: 'shell_command', command: 'id' })).rejects.toThrow(/disabled/)
    await expect(host.command('session-1', { type: 'close' })).rejects.toThrow(/stop control/)
    await expect(host.command('session-1', { type: 'tool_call_result', executionId: 'x' })).rejects.toThrow(/bridge/)
    await expect(host.command('session-1', { type: 'permission_decision', requestId: 'p1', behavior: 'allow', updatedInput: [] })).rejects.toThrow(/object/)
  })

  it('returns only the profile selected by the current session', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ profiles: [{ name: 'alice:codex', engine: 'codex' }, { name: 'bob:claude', engine: 'claude' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    try {
      const host = await createBuilderHost({ repoRoot: '/box', instanceDir: '/box/data' })
      await expect(host.sessionProfiles('session-1')).resolves.toEqual([{ name: 'alice:codex', engine: 'codex' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
