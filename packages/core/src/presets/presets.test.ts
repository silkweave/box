// Preset modules come from the registered features, so a Box that adds a board with a preset bar
// declares it in its manifest instead of editing core.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../io.js'

vi.mock('../generated/features.js', () => ({
  FEATURE_LIST: [
    { id: 'alpha', models: [], migrations: [], presetModules: ['alpha', 'alpha-deals'] },
    { id: 'beta', models: [], migrations: [] },
  ],
}))

const { assertKnownModule, deletePreset, presetModules, readPresets, readPresetsFile, readReadablePresets, savePreset, seedPresets } = await import('./presets.js')
const { fillRequest, runInRequest } = await import('../request-context.js')
const { policyRevision } = await import('../auth/access.js')

function as<T>(areas: Record<string, 'read' | 'write'>, fn: () => T): T {
  return runInRequest(() => {
    fillRequest({
      principal: { id: 'probe', display: 'Probe', role: 'presets-probe', kind: 'human' } as never,
      access: { role: 'presets-probe', areas: new Map(Object.entries(areas)), fallback: 'none', admin: false, revision: policyRevision() },
    })
    return fn()
  })
}

describe('preset modules', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'presets-'))
    setInstanceDir(dir)
  })
  afterAll(() => {
    resetInstanceDir()
    rmSync(dir, { recursive: true, force: true })
  })

  it('are what the registered features declare', () => {
    expect(presetModules()).toEqual(['alpha', 'alpha-deals'])
  })

  it('refuse a module no feature registers', () => {
    expect(() => assertKnownModule('alpha-deals')).not.toThrow()
    expect(() => assertKnownModule('gamma')).toThrow(/unknown module "gamma" - one of alpha, alpha-deals/)
    expect(() => readPresets('gamma')).toThrow()
  })

  it('store presets per registered module', () => {
    savePreset('alpha-deals', 'Closing soon', { search: '' }, 'tester')
    expect(readPresets('alpha-deals').map((p) => p.name)).toEqual(['Closing soon'])
    expect(Object.keys(readPresetsFile().modules)).toEqual(['alpha', 'alpha-deals'])
  })
})

describe('preset access by the declaring feature\'s area (W8 R3)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'presets-access-'))
    setInstanceDir(dir)
  })
  afterAll(() => {
    resetInstanceDir()
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists only readable modules, refuses reads and writes without the area', () => {
    savePreset('alpha', 'Pipeline', { a: 1 })
    as({ beta: 'write' }, () => {
      expect(readReadablePresets()).toEqual({ seeded: [], modules: {}, writable: [] })
      expect(() => readPresets('alpha')).toThrow(expect.objectContaining({ area: 'alpha', needed: 'read' }))
      expect(() => savePreset('alpha', 'X', {})).toThrow(expect.objectContaining({ area: 'alpha', needed: 'write' }))
    })
    as({ alpha: 'read' }, () => {
      expect(Object.keys(readReadablePresets().modules)).toEqual(['alpha', 'alpha-deals'])
      // A reader is told it may write nothing, so the SPA offers no save, manage or seed.
      expect(readReadablePresets().writable).toEqual([])
      expect(readPresets('alpha').map((p) => p.name)).toEqual(['Pipeline'])
      expect(() => deletePreset('alpha', 'Pipeline')).toThrow(expect.objectContaining({ area: 'alpha', needed: 'write' }))
    })
  })

  it('names the modules the caller may write', () => {
    as({ alpha: 'write' }, () => expect(readReadablePresets().writable).toEqual(['alpha', 'alpha-deals']))
  })

  it('a reader\'s initial seed leaves an unseeded module alone; its restore is refused', () => {
    const seed = [{ name: 'Default', state: {} }]
    as({ alpha: 'read' }, () => {
      expect(seedPresets('alpha-deals', seed, 'initial')).toEqual([])
      expect(() => seedPresets('alpha-deals', seed, 'restore')).toThrow(expect.objectContaining({ needed: 'write' }))
    })
    expect(readPresetsFile().seeded).toEqual([])
    as({ alpha: 'write' }, () => expect(seedPresets('alpha-deals', seed, 'initial').map((p) => p.name)).toEqual(['Default']))
    expect(readPresetsFile().seeded).toEqual(['alpha-deals'])
  })
})
