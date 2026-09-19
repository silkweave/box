import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { BOX_BRAND_KEYS, BOX_JSON_SCHEMA_REF, defaultBoxJson, parseBoxJson, readBoxConfig, writeBoxLocal } from './box-json.js'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync('/tmp/box-config-'); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
test('defaults expose the root schema and new sections', () => {
  const config = defaultBoxJson()
  expect(BOX_JSON_SCHEMA_REF).toBe('./packages/core/box.schema.json')
  expect(Object.keys(config.brand)).toEqual([...BOX_BRAND_KEYS])
  expect(config.auth).toEqual({ sessionSecret: null, tokenSecret: null })
})
test('local config deeply merges and replaces arrays', () => {
  const dir = temp()
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ server: { port: 8200 }, features: { x: { a: 1, list: [1, 2] } } }))
  writeFileSync(join(dir, 'box.local.json'), JSON.stringify({ server: { port: 8300, dashboardUrl: null }, features: { x: { b: 2, list: [3] } } }))
  const config = readBoxConfig(dir)
  expect(config.server).toMatchObject({ port: 8300, dashboardUrl: null })
  expect(config.features.x).toEqual({ a: 1, b: 2, list: [3] })
})
test('rejects unknown and malformed dynamic values', () => {
  expect(() => parseBoxJson({ nope: true })).toThrow(/unknown key/)
  expect(() => parseBoxJson({ features: { x: [] } })).toThrow(/must be an object/)
  expect(() => parseBoxJson({ accounts: { x: {} } })).toThrow(/must be an array/)
  expect(() => parseBoxJson({ credentials: { x: { y: { z: 1 } } } })).toThrow(/must be a string/)
  expect(() => parseBoxJson({ agentProfiles: { nova: { codex: 1 } } })).toThrow(/must be a non-empty string/)
})
test('writeBoxLocal validates before atomic 0600 write', () => {
  const dir = temp(); writeFileSync(join(dir, 'box.json'), JSON.stringify({ server: { port: 8200 } }))
  writeBoxLocal(dir, { auth: { tokenSecret: 'secret' } })
  expect(readBoxConfig(dir).auth.tokenSecret).toBe('secret')
  expect(statSync(join(dir, 'box.local.json')).mode & 0o777).toBe(0o600)
  const before = readFileSync(join(dir, 'box.local.json'), 'utf8')
  expect(() => writeBoxLocal(dir, { server: { port: 0 } })).toThrow(/port must be a port number/)
  expect(readFileSync(join(dir, 'box.local.json'), 'utf8')).toBe(before)
})

test('rejects unsafe nested keys even when their object has no base value', () => {
  const dir = temp()
  writeFileSync(join(dir, 'box.local.json'), '{"features":{"x":{"items":[{"__proto__":{"polluted":true}}]}}}')
  expect(() => readBoxConfig(dir)).toThrow(/unsafe key/)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

test('a local object cannot conceal an invalid shared file', () => {
  const dir = temp()
  writeFileSync(join(dir, 'box.json'), '[]')
  writeFileSync(join(dir, 'box.local.json'), '{}')
  expect(() => readBoxConfig(dir)).toThrow(/must contain a JSON object/)
  expect(() => writeBoxLocal(dir, { server: { port: 8198 } })).toThrow(/must contain a JSON object/)
  expect(readFileSync(join(dir, 'box.local.json'), 'utf8')).toBe('{}')
})

test('configuration ignores shell variables and does not load dotenv files', () => {
  const dir = temp()
  const before = process.env.PORT
  process.env.PORT = '9000'
  try {
    writeFileSync(join(dir, '.env'), 'PORT=9001\n')
    writeFileSync(join(dir, 'box.json'), '{"server":{"port":8198}}')
    expect(readBoxConfig(dir).server.port).toBe(8198)
    expect(process.env.PORT).toBe('9000')
  } finally {
    if (before === undefined) delete process.env.PORT
    else process.env.PORT = before
  }
})
