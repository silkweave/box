import { describe, expect, it } from 'vitest'
import { deviceHint } from './device-hint.js'

describe('deviceHint', () => {
  it('names the browser and system from common User-Agents', () => {
    expect(deviceHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome on macOS')
    expect(deviceHint('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS')
    expect(deviceHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe('Edge on Windows')
    expect(deviceHint('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox on Linux')
    expect(deviceHint('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android')
  })

  it('is null for nothing recognisable', () => {
    expect(deviceHint(undefined)).toBeNull()
    expect(deviceHint('')).toBeNull()
    expect(deviceHint('curl/8.7.1')).toBeNull()
  })
})
