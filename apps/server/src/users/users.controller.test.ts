// The people directory reads (`users-list`, `user-get`) against a throwaway warehouse: any
// principal reads a profile, the email included, and never a token.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '@silkweave/box-core/testing'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { agentsDir, ensureAgentPrincipals, upsertUser } from '@silkweave/box-core'
import { UsersController } from './users.controller.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-users-'))
  setInstanceDir(dir)
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), 'stella.md'), '---\nname: Stella\nrole: member\n---\n')
  await ensureAgentPrincipals()
  await upsertUser({ id: 'alice', first_name: 'Alice', email: 'alice@example.com' })
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('users directory reads', () => {
  it('user-get returns one profile with its email and no token', async () => {
    const user = await new UsersController().get({ id: 'alice' })
    expect(user).toMatchObject({ id: 'alice', first_name: 'Alice', email: 'alice@example.com' })
    expect(typeof user.has_token).toBe('boolean')
    expect(JSON.stringify(user)).not.toMatch(/"token"/)
  })

  it('user-get refuses an unknown id and points at users-list', async () => {
    await expect(new UsersController().get({ id: 'nobody' })).rejects.toThrow(/users-list/)
  })

  it('users-list includes the profile', async () => {
    const { users } = await new UsersController().list()
    expect(users.find((u) => u.id === 'alice')?.email).toBe('alice@example.com')
  })
})

describe('agent rows', () => {
  it('lists agents as kind agent and refuses to invite, disable or delete one', async () => {
    await upsertUser({ id: 'root', nickname: 'root', role: 'admin' })
    const controller = new UsersController()
    const { users } = await controller.list()
    expect(users.find((u) => u.id === 'stella')?.kind).toBe('agent')
    expect(users.find((u) => u.id === 'alice')?.kind).toBe('human')
    const req = { principal: { id: 'root', role: 'admin' } }
    await expect(controller.invite({ id: 'stella' }, req)).rejects.toThrow(/is an agent/)
    await expect(controller.accessRevoke({ id: 'stella' }, req)).rejects.toThrow(/is an agent/)
    await expect(controller.delete({ id: 'stella' }, req)).rejects.toThrow(/never deleted/)
    await expect(controller.link({ id: 'stella' }, req)).rejects.toThrow(/not a link/)
  })
})

describe('work capabilities', () => {
  it('default on, admin-set, member-refused, folders validated', async () => {
    const controller = new UsersController()
    const admin = { principal: { id: 'root', role: 'admin' } } as never
    const self = { principal: { id: 'alice', role: 'member' } } as never
    expect((await controller.get({ id: 'alice' })).work).toEqual({ enabled: true, data: true, sandbox: true, folders: false, folder_paths: [] })
    await expect(controller.upsert({ id: 'alice', work: JSON.stringify({ data: false }) }, self)).rejects.toThrow(/admin-only/)
    const updated = await controller.upsert({ id: 'alice', work: JSON.stringify({ data: false, folders: true, folder_paths: [tmpdir()] }) }, admin)
    expect(updated.work).toMatchObject({ enabled: true, data: false, folders: true })
    expect(updated.work.folder_paths).toHaveLength(1)
    await expect(controller.upsert({ id: 'alice', work: JSON.stringify({ folder_paths: ['relative/dir'] }) }, admin)).rejects.toThrow(/absolute/)
    await expect(controller.upsert({ id: 'alice', work: '[1]' }, admin)).rejects.toThrow(/JSON object/)
    // A later partial write merges over the stored value.
    const again = await controller.upsert({ id: 'alice', work: JSON.stringify({ sandbox: false }) }, admin)
    expect(again.work).toMatchObject({ data: false, sandbox: false, folders: true })
  })

  it('folder picker lists grantable directories and creates one level', () => {
    const controller = new UsersController()
    const host = mkdtempSync(join(tmpdir(), 'box-work-folders-'))
    mkdirSync(join(host, 'projects'))
    mkdirSync(join(host, 'photos'))
    mkdirSync(join(host, '.hidden'))
    const listed = controller.workFolders({ query: `${host}/p` })
    expect(listed.parent).toBe(host)
    expect(listed.directories).toEqual([join(host, 'photos'), join(host, 'projects')])
    expect(listed.create).toBe(join(host, 'p'))
    expect(controller.workFolders({ query: join(host, 'projects') }).create).toBeNull()
    expect(controller.workFolders({ query: `${host}/` }).directories).not.toContain(join(host, '.hidden'))
    // The instance dir (the test warehouse) is never offered, and nothing under it.
    expect(controller.workFolders({ query: `${dir}/` }).directories).toEqual([])
    expect(controller.workFolders({ query: 'relative' })).toEqual({ parent: null, directories: [], create: null })
    const fresh = join(host, 'new')
    expect(controller.workFolders({ query: fresh }).create).toBe(fresh)
    expect(controller.workFolderCreate({ path: fresh })).toEqual({ path: fresh })
    expect(existsSync(fresh)).toBe(true)
    expect(() => controller.workFolderCreate({ path: fresh })).toThrow(/already exists/)
    expect(() => controller.workFolderCreate({ path: join(host, 'a', 'b') })).toThrow(/parent/)
    expect(() => controller.workFolderCreate({ path: join(dir, 'new') })).toThrow(/instance/)
    rmSync(host, { recursive: true, force: true })
  })
})
