// A person's sidebar layout against a real warehouse: stored per person, untouched by a profile
// edit (the record layer's upsert carries every column), and refused when malformed.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureSchema } from '../warehouse/db.js'
import { readUser, upsertUser } from './state.js'
import { parseSidebarLayout, readSidebarLayout, writeSidebarLayout } from './sidebar.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-sidebar-'))
  setInstanceDir(dir)
  await ensureSchema()
  await upsertUser({ id: 'alice', nickname: 'Alice' })
  await upsertUser({ id: 'bob', nickname: 'Bob' })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('sidebar layout', () => {
  const layout = { sections: ['Sales', 'Workspace'], groups: ['crm', 'home'], hidden: ['boards'] }

  it('is null (the default) until the person arranges it', async () => {
    expect(await readSidebarLayout('alice')).toBeNull()
  })

  it('is stored per person and survives a profile edit', async () => {
    await writeSidebarLayout('alice', layout)
    await upsertUser({ id: 'alice', first_name: 'Alice' })
    expect(await readSidebarLayout('alice')).toEqual(layout)
    expect(await readSidebarLayout('bob')).toBeNull()
    expect(Object.keys((await readUser('alice')) ?? {})).not.toContain('sidebar')
  })

  it('resets to the default with null', async () => {
    await writeSidebarLayout('alice', null)
    expect(await readSidebarLayout('alice')).toBeNull()
  })

  it('drops duplicate ids and refuses a malformed layout', () => {
    expect(parseSidebarLayout({ sections: ['a', 'a'], groups: [], hidden: ['x', 'x'] })).toEqual({ sections: ['a'], groups: [], hidden: ['x'] })
    expect(() => parseSidebarLayout([])).toThrow()
    expect(() => parseSidebarLayout({ sections: [1] })).toThrow()
    expect(() => parseSidebarLayout({ groups: Array.from({ length: 201 }, (_, i) => `g${i}`) })).toThrow()
  })
})
