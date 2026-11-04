import { describe, expect, it } from 'vitest'
import { isRawUploadRoute, registerRawUploadRoute } from './raw-uploads.js'

describe('raw upload routes', () => {
  it('matches only the registered method and a path below the prefix', () => {
    const off = registerRawUploadRoute({ id: 'test', method: 'PUT', prefix: '/api/things/upload/' })
    expect(isRawUploadRoute('PUT', '/api/things/upload/abc')).toBe(true)
    expect(isRawUploadRoute('POST', '/api/things/upload/abc')).toBe(false)
    expect(isRawUploadRoute('PUT', '/api/things/upload/')).toBe(false)
    expect(isRawUploadRoute('PUT', '/api/things/other')).toBe(false)
    expect(() => registerRawUploadRoute({ id: 'test', method: 'PUT', prefix: '/api/x/' })).toThrow(/twice/)
    expect(() => registerRawUploadRoute({ id: 'bad', method: 'PUT', prefix: '/things/' })).toThrow(/prefix/)
    off()
    expect(isRawUploadRoute('PUT', '/api/things/upload/abc')).toBe(false)
  })
})
