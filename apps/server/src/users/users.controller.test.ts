// The people directory reads (`users-list`, `user-get`) against a throwaway warehouse: any
// principal reads a profile, the email included, and never a token.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '@silkweave/box-core/testing'
import { upsertUser } from '@silkweave/box-core'
import { UsersController } from './users.controller.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-users-'))
  setInstanceDir(dir)
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
