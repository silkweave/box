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

const { assertKnownModule, presetModules, readPresets, readPresetsFile, savePreset } = await import('./presets.js')

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
