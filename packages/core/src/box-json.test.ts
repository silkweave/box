import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { BOX_BRAND_KEYS, BOX_JSON_SCHEMA_REF, defaultBoxJson, parseBoxJson, readBoxConfig, stackSourceKind, writeBoxLocal } from './box-json.js'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync('/tmp/box-config-'); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
test('defaults expose the root schema and new sections', () => {
  const config = defaultBoxJson()
  expect(BOX_JSON_SCHEMA_REF).toBe('./packages/core/box.schema.json')
  expect(Object.keys(config.brand)).toEqual([...BOX_BRAND_KEYS])
  expect(config.auth).toEqual({ sessionSecret: null, tokenSecret: null })
})
test('server.host defaults to loopback and accepts an explicit interface', () => {
  expect(defaultBoxJson().server.host).toBe('127.0.0.1')
  expect(parseBoxJson({ server: { host: '0.0.0.0' } }).server.host).toBe('0.0.0.0')
  expect(parseBoxJson({ server: { host: '::' } }).server.host).toBe('::')
  expect(() => parseBoxJson({ server: { host: '' } })).toThrow(/host must be a non-empty string/)
  expect(() => parseBoxJson({ server: { host: 'http://box' } })).toThrow(/bare address or hostname/)
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

test('stack.source defaults to the GitHub Stack and a local file overrides it', () => {
  expect(defaultBoxJson().stack).toEqual({ source: 'silkweave/stack' })
  expect(parseBoxJson({}).stack.source).toBe('silkweave/stack')
  expect(parseBoxJson({ stack: { source: ' .. ' } }).stack.source).toBe('..')
  const dir = temp()
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ stack: { source: 'silkweave/stack' } }))
  writeFileSync(join(dir, 'box.local.json'), JSON.stringify({ stack: { source: '../stack' } }))
  expect(readBoxConfig(dir).stack.source).toBe('../stack')
})

test('stack.source is refused when it is blank, unknown or names no recognised form', () => {
  expect(() => parseBoxJson({ stack: { source: '' } })).toThrow(/source must be a non-empty string/)
  expect(() => parseBoxJson({ stack: { source: 3 } })).toThrow(/source must be a non-empty string/)
  expect(() => parseBoxJson({ stack: { ref: 'main' } })).toThrow(/unknown key "ref"/)
  expect(() => parseBoxJson({ stack: 'silkweave/stack' })).toThrow(/stack must be an object/)
  expect(() => parseBoxJson({ stack: { source: 'stack' } })).toThrow(/GitHub owner\/repo/)
})

test('stackSourceKind classifies each accepted form deterministically', () => {
  for (const path of ['.', '..', '~', '~/src/stack', '/abs/stack', './stack', '../stack', '/with space/stack']) expect(stackSourceKind(path)).toBe('path')
  for (const url of ['https://github.com/o/r.git', 'ssh://git@host/o/r.git', 'git@github.com:o/r.git', 'file:///tmp/stack']) expect(stackSourceKind(url)).toBe('git')
  for (const shorthand of ['silkweave/stack', 'my.org/my-repo.git']) expect(stackSourceKind(shorthand)).toBe('github')
  for (const bad of ['', 'stack', 'a/b/c', 'o/..', '~user/stack', 'owner/re po']) expect(stackSourceKind(bad)).toBe(null)
})
test('the recipes ledger records adapted recipes and their powerups', () => {
  expect(defaultBoxJson().recipes).toEqual({})
  const config = parseBoxJson({ recipes: { chat: { powerups: ['mobile', 'mobile'] }, mobile: {}, reminders: { _note: 'first', powerups: [] } } })
  expect(config.recipes).toEqual({ chat: { powerups: ['mobile'] }, mobile: { powerups: [] }, reminders: { powerups: [] } })
  expect(() => parseBoxJson({ recipes: [] })).toThrow(/recipes must be an object/)
  expect(() => parseBoxJson({ recipes: { Chat: {} } })).toThrow(/not a recipe id/)
  expect(() => parseBoxJson({ recipes: { chat: true } })).toThrow(/chat must be an object/)
  expect(() => parseBoxJson({ recipes: { chat: { powerups: 'mobile' } } })).toThrow(/must be an array/)
  expect(() => parseBoxJson({ recipes: { chat: { powerups: ['Mobile'] } } })).toThrow(/not a powerup id/)
  expect(() => parseBoxJson({ recipes: { chat: { adapted: true } } })).toThrow(/unknown key "adapted"/)
})

test('the removed workerdeckTokens key is refused with the replacement named', () => {
  expect(() => parseBoxJson({ workerdeckTokens: {} })).toThrow(/workerdeckTokens was removed; connect Claude accounts in Settings > Agent accounts/)
})
