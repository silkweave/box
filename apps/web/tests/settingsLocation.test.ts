import { describe, expect, test } from 'bun:test'
import { parseSettingsHash, settingsHash } from '../src/lib/settingsLocation.ts'

describe('settings deep links', () => {
  test('unrelated anchors do not open Settings', () => {
    for (const hash of ['', '#notes', '#settings-other', '#/initiatives']) expect(parseSettingsHash(hash)).toBeUndefined()
  })
  test('bare links open Profile and nested paths retain their segments', () => {
    expect(parseSettingsHash('#settings')).toEqual({ section: 'profile', params: [] })
    expect(parseSettingsHash('settings/')).toEqual({ section: 'profile', params: [] })
    expect(parseSettingsHash(settingsHash('automation/runs/run-42'))).toEqual({ section: 'automation', params: ['runs', 'run-42'] })
    expect(parseSettingsHash('#settings/users/new')).toEqual({ section: 'users', params: ['new'] })
  })
  test('old section names still reach their configuration surfaces', () => {
    expect(parseSettingsHash('#settings/schedules')).toEqual({ section: 'automation', params: ['schedules'] })
    expect(parseSettingsHash('#settings/rules')).toEqual({ section: 'automation', params: ['triggers'] })
  })
})
