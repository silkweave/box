import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { readSignalOwnersFile, resolveSignalOwner, writeSignalOwnersFile } from './owners.js'

let root: string | undefined
afterEach(() => { resetInstanceDir(); if (root) rmSync(root, { recursive: true, force: true }) })
test('removing an inherited signal override falls back to its channel while explicit null stays unowned', () => {
  root = mkdtempSync(join(tmpdir(), 'box-owner-config-'))
  setInstanceDir(root)
  writeFileSync(join(root, 'box.json'), JSON.stringify({ signals: { owners: {
    channels: { github: 'alice' }, signals: { 'github.stars': 'bob', 'github.forks': null },
  } } }))
  writeSignalOwnersFile({ channels: { github: 'alice' }, signals: { 'github.forks': null } })
  const saved = readSignalOwnersFile()
  expect(resolveSignalOwner(saved, 'github', 'github.stars')).toBe('alice')
  expect(resolveSignalOwner(saved, 'github', 'github.forks')).toBeNull()
})
