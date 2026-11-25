import { describe, expect, it } from 'bun:test'
import { browserPreviewPath } from '@silkweave/box-core/builder-browser'
import { previewNavigationPath, previewResetTarget } from '../src/lib/builderPreview.ts'

describe('Builder Preview recovery', () => {
  it('resets to the last app route unless that route is the page that failed', () => {
    expect(previewResetTarget({ path: '/artifacts/welcome/', usable: false }, '/signals')).toBe('/signals')
    expect(previewResetTarget({ path: null, usable: false }, '/signals')).toBe('/signals')
    expect(previewResetTarget({ path: '/signals', usable: false }, '/signals')).toBe('/')
    expect(previewResetTarget({ path: '/signals', usable: true }, '/signals')).toBe('/signals')
  })

  it('opens app and artifact paths but refuses infrastructure, sign-in and settings paths', () => {
    expect(previewNavigationPath('/recipes?view=list', browserPreviewPath)).toBe('/recipes?view=list')
    expect(previewNavigationPath('/artifacts/welcome/', browserPreviewPath)).toBe('/artifacts/welcome/')
    for (const path of ['/builder', '/builder-assets/x.js', '/api/keys', '/settings', '/login', 'https://elsewhere.test/', '//elsewhere.test', '/?token=x', 42]) {
      expect(previewNavigationPath(path, browserPreviewPath)).toBeNull()
    }
  })
})
