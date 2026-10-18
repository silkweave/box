import { describe, expect, it } from 'vitest'
import type { Principal, User, WorkFs } from '@silkweave/box-core'
import { applyWorkSessionPolicy, createWorkToolGuard, workGrantOf, workRunnerConfig, WorkSessionError } from './work-session.js'

const sandbox = '/box/data/work/mia'
const projects = '/srv/projects'
const fs: WorkFs = {
  isDirectory: (p) => [projects, sandbox, '/box', '/box/data'].includes(p),
  realpath: (p) => {
    if ([projects, sandbox, '/box', '/box/data', '/box/data/work', '/srv'].includes(p)) return p
    throw new Error('ENOENT')
  },
  listDirectories: () => [],
}
const person = (over: Partial<User['work']> = {}, status: User['status'] = 'active'): User =>
  ({
    id: 'mia', status, role: 'member', kind: 'human',
    work: { enabled: true, data: true, sandbox: true, folders: false, folder_paths: [], ...over },
  }) as unknown as User
const member: Principal = { id: 'mia', display: 'Mia', role: 'member', kind: 'human' }
const admin: Principal = { id: 'toby', display: 'Toby', role: 'admin', kind: 'human' }
const deps = (user: User | null) => ({ readUser: async () => user, fs, sandboxDir: () => sandbox, mkdir: () => {} })

describe('applyWorkSessionPolicy', () => {
  it('leaves an admin alone apart from stripping a forged grant', async () => {
    const body: Record<string, unknown> = { cwd: '/box', meta: { user: 'toby', work: { user: 'x', roots: ['/'], data: true } } }
    expect(await applyWorkSessionPolicy(body, admin, 'codex', deps(null))).toBeNull()
    expect(body).toEqual({ cwd: '/box', meta: { user: 'toby' } })
  })

  it('moves a member into their sandbox and stamps the grant', async () => {
    const body: Record<string, unknown> = { cwd: '/box', meta: { user: 'mia', work: 'forged' } }
    const grant = await applyWorkSessionPolicy(body, member, 'claude', deps(person()))
    expect(grant).toEqual({ user: 'mia', roots: [sandbox], data: true })
    expect(body.cwd).toBe(sandbox)
    expect(body.meta).toEqual({ user: 'mia', work: grant })
  })

  it('records data off and adds admin folders when on; refuses an engine without the hook', async () => {
    const body: Record<string, unknown> = {}
    const grant = await applyWorkSessionPolicy(body, member, 'claude', deps(person({ data: false, folders: true, folder_paths: [projects] })))
    expect(grant).toEqual({ user: 'mia', roots: [sandbox, projects], data: false })
    await expect(applyWorkSessionPolicy({}, member, 'codex', deps(person()))).rejects.toMatchObject({ code: 'work_engine_unsupported' })
  })

  it('refuses a disabled, revoked or unknown member and an ungrantable folder', async () => {
    await expect(applyWorkSessionPolicy({}, member, 'claude', deps(person({ enabled: false })))).rejects.toMatchObject({ status: 403, code: 'work_disabled' })
    await expect(applyWorkSessionPolicy({}, member, 'claude', deps(person({}, 'revoked')))).rejects.toMatchObject({ code: 'work_unavailable' })
    await expect(applyWorkSessionPolicy({}, member, 'claude', deps(null))).rejects.toBeInstanceOf(WorkSessionError)
    await expect(applyWorkSessionPolicy({}, member, 'claude', deps(person({ folders: true, folder_paths: ['/nope'] })))).rejects.toMatchObject({ code: 'work_folder_invalid' })
  })
})

describe('the tool guard', () => {
  const grant = { user: 'mia', roots: [sandbox], data: true }
  const guard = (user: User | null) => createWorkToolGuard(grant, sandbox, { readUser: async () => user, fs, checkout: () => '/box' })
  const call = (tool: string, tool_input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input })
  const opts = { signal: new AbortController().signal }
  const denied = (out: Awaited<ReturnType<ReturnType<typeof guard>>>) => out.hookSpecificOutput?.permissionDecision === 'deny'

  it('allows the sandbox and unguarded tools, refuses the checkout', async () => {
    const g = guard(person())
    expect(await g(call('Write', { file_path: `${sandbox}/a.md` }), undefined, opts)).toEqual({})
    expect(await g(call('WebFetch', { url: 'https://x' }), undefined, opts)).toEqual({})
    expect(await g(call('mcp__team-box__TasksList', {}), undefined, opts)).toEqual({})
    expect(await g(call('mcp__workerdeck__peers_list', {}), undefined, opts)).toEqual({})
    expect(denied(await g(call('Edit', { file_path: '/box/box.json' }), undefined, opts))).toBe(true)
    expect(denied(await g(call('Bash', { command: 'git commit -m x' }), undefined, opts))).toBe(true)
  })

  it('applies the live settings: folders added, data removed, Work turned off, account revoked', async () => {
    const live = guard(person({ folders: true, folder_paths: [projects], data: false }))
    expect(await live(call('Write', { file_path: `${projects}/x.ts` }), undefined, opts)).toEqual({})
    expect(denied(await live(call('mcp__team-box__TasksList', {}), undefined, opts))).toBe(true)
    expect(await live(call('mcp__workerdeck__peers_list', {}), undefined, opts)).toEqual({})
    expect(denied(await guard(person({ enabled: false }))(call('Bash', { command: 'ls' }), undefined, opts))).toBe(true)
    expect(denied(await guard(person({}, 'revoked'))(call('Bash', { command: 'ls' }), undefined, opts))).toBe(true)
    expect(denied(await guard(null)(call('Read', { file_path: `${sandbox}/a` }), undefined, opts))).toBe(true)
  })

  it('fails closed when the settings cannot be read', async () => {
    const g = createWorkToolGuard(grant, sandbox, { readUser: async () => { throw new Error('db down') }, fs, checkout: () => '/box' })
    expect(denied(await g(call('Bash', { command: 'ls' }), undefined, opts))).toBe(true)
    expect(await g(call('WebFetch', {}), undefined, opts)).toEqual({})
  })
})

describe('workRunnerConfig', () => {
  it('adds instructions, the hook and the extra folders only to a guarded request', () => {
    const plain = { cwd: '/box', meta: { user: 'toby' } }
    expect(workRunnerConfig(plain)).toBe(plain)
    expect(workGrantOf({ work: { user: 'mia', roots: 'no', data: true } })).toBeNull()
    const built = workRunnerConfig({ cwd: sandbox, meta: { work: { user: 'mia', roots: [sandbox, projects], data: false } } }) as Record<string, unknown>
    expect(built.instructions).toMatch(/not available/)
    const extra = built.extraOptions as { hooks: { PreToolUse: unknown[] }; additionalDirectories: string[] }
    expect(extra.hooks.PreToolUse).toHaveLength(1)
    expect(extra.additionalDirectories).toEqual([projects])
  })
})
