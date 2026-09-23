import { describe, expect, it } from 'vitest'
import { parseDevLogLevel } from './dev-view.js'

describe('box dev log level', () => {
  it('defaults to info and accepts long and shorthand forms', () => {
    expect(parseDevLogLevel([])).toBe('info')
    expect(parseDevLogLevel(['--log-level', 'warn'])).toBe('warn')
    expect(parseDevLogLevel(['--log-level=error'])).toBe('error')
    expect(parseDevLogLevel(['--verbose'])).toBe('verbose')
    expect(parseDevLogLevel(['--debug'])).toBe('debug')
  })

  it('refuses unknown levels', () => {
    expect(() => parseDevLogLevel(['--log-level', 'trace'])).toThrow(/error, warn, info, verbose, debug/)
    expect(() => parseDevLogLevel(['--log-level'])).toThrow(/needs a value/)
  })
})
