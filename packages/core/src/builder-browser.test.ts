import { describe, expect, it } from 'vitest'
import { browserPreviewPath, isBrowserShellCommand, parseBrowserCommand } from './builder-browser.js'

describe('Builder browser command boundary', () => {
  it('accepts local application routes while excluding encoded infrastructure and secret queries', () => {
    expect(browserPreviewPath('/signals?view=list#recent')).toBe('/signals?view=list#recent')
    for (const path of ['https://elsewhere.test/', '//elsewhere.test/', '/\\elsewhere.test', '/a/../api/keys', '/%61pi/keys', '/%2561pi/keys', '/%2f%2felsewhere.test', '/builder-browser', '/builder-assets/main.js', '/settings', '/login', '/auth/link', '/?access_token=private', '/?code=private', '/\nsettings', '/%zz']) {
      expect(browserPreviewPath(path), path).toBeNull()
    }
  })

  it('exposes only typed bounded operations without arbitrary scripts or selectors', () => {
    expect(parseBrowserCommand({ op: 'snapshot', script: 'bad', selector: '*' })).toEqual({ op: 'snapshot' })
    expect(parseBrowserCommand({ op: 'type', ref: 'element', text: 'Hello', append: true })).toEqual({ op: 'type', ref: 'element', text: 'Hello', append: true })
    for (const command of [null, [], { op: 'eval' }, { op: 'click', ref: '' }, { op: 'type', ref: 'x', text: 'x'.repeat(10001) }, { op: 'type', ref: 'x', text: 'hello', append: 'yes' }, { op: 'scroll', x: Infinity, y: 1 }, { op: 'scroll', x: 10001, y: 1 }, { op: 'style', ref: 'x', styles: { color: 12 } }]) {
      expect(() => parseBrowserCommand(command)).toThrow()
    }
  })

  it('parses the shell operations that recover the Preview on any page', () => {
    expect(parseBrowserCommand({ op: 'state', extra: 1 })).toEqual({ op: 'state' })
    expect(parseBrowserCommand({ op: 'reset' })).toEqual({ op: 'reset' })
    expect(parseBrowserCommand({ op: 'navigate', path: '/artifacts/welcome/' })).toEqual({ op: 'navigate', path: '/artifacts/welcome/' })
    expect(browserPreviewPath('/artifacts/welcome/')).toBe('/artifacts/welcome/')
    for (const op of ['state', 'reset', 'navigate']) expect(isBrowserShellCommand(parseBrowserCommand({ op, path: '/' }))).toBe(true)
    for (const command of [{ op: 'snapshot' }, { op: 'click', ref: 'x' }, { op: 'screenshot' }]) expect(isBrowserShellCommand(parseBrowserCommand(command))).toBe(false)
    expect(() => parseBrowserCommand({ op: 'navigate' })).toThrow()
  })
})
