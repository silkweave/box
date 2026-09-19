// Root `box.json` and optional `box.local.json` are the files a Box is configured in.
//
// This module is the file's SHAPE: its types, its defaults, a validating parser, a reader that
// falls back to the defaults when the file is absent. It imports only Node builtins and stays
// within erasable TypeScript syntax: apps/web's vite config loads it without the workspace's
// @silkweave/box-source condition, `packages/cli` runs it through Node's own type stripping (no
// loader), and the server reaches it through core. Everything that knows WHERE the running Box's
// file is lives in box-config.ts.
//
// Secret values may be stored in the mode-0600 local override. This file is the one a person edits.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The system principal: the machine account every Box has. `role` is `UserRole` in users/types.ts. */
export interface BoxAgent {
  id: string
  name: string
  role: 'admin' | 'member'
}

/** Product name and artwork. Baked into the SPA at build time and read by the server at call time. */
export interface BoxBrand {
  name: string
  shortName: string
  description: string
  wordmark: string
  suffix: string
  logoUrl: string
  icon192: string
  icon512: string
  appleTouchIcon: string
  backgroundColor: string
  themeColor: string
}

export interface BoxServer {
  /** The port Nest serves on. */
  port: number
  /** The Vite dev-server port Nest proxies in dev. */
  vitePort: number
  viteDevUrl: string | null
  /** This Box's browser-facing origin for links in invites and notifications. */
  dashboardUrl: string | null
  /** ssh host for "Open in VS Code" Remote-SSH links. */
  vscodeRemoteHost: string | null
}
export interface BoxAuth { sessionSecret: string | null; tokenSecret: string | null }
export interface BoxMcp { url: string | null; token: string | null }
export interface BoxHttp { userAgent: string }

export interface BoxBackup {
  /** GCS bucket (no `gs://`) every warehouse backup is also uploaded to. */
  gcsBucket: string | null
}

/** Background work is OFF unless an adopted app is armed here (or by its env var). */
export interface BoxBackground {
  /** Arms the cron scheduler. */
  automation: boolean
  /** Arms the in-chat agent. */
  chatAgent: boolean
  /** Arms the webhook relay. */
  relay: boolean
}

export interface BoxJson {
  agent: BoxAgent
  brand: BoxBrand
  server: BoxServer
  backup: BoxBackup
  background: BoxBackground
  auth: BoxAuth
  mcp: BoxMcp
  http: BoxHttp
  features: Record<string, Record<string, unknown>>
  workerdeck: Record<string, unknown> | null
  workerdeckTokens: Record<string, string>
  accounts: Record<string, unknown[]>
  credentials: Record<string, Record<string, Record<string, string>>>
  agentProfiles: Record<string, Record<string, string>>
}

/** Where the written file points its editor at, relative to `data/`. The schema ships with core. */
export const BOX_JSON_SCHEMA_REF = './packages/core/box.schema.json'

/** Every brand key, in file order. The deprecated `BOX_BRAND` getters and the schema test read it. */
export const BOX_BRAND_KEYS = [
  'name', 'shortName', 'description', 'wordmark', 'suffix', 'logoUrl', 'icon192', 'icon512',
  'appleTouchIcon', 'backgroundColor', 'themeColor',
] as const satisfies readonly (keyof BoxBrand)[]

/** A fresh copy of the defaults: a Box that never edited its file behaves exactly like this. */
export function defaultBoxJson(): BoxJson {
  return {
    agent: { id: 'nova', name: 'Nova', role: 'admin' },
    brand: {
      name: 'Silkweave Box',
      shortName: 'Box',
      description: 'Silkweave Box - your office in a box',
      wordmark: 'silkweave',
      suffix: 'box',
      logoUrl: '/brand-logo.svg',
      icon192: '/push-icon.png',
      icon512: '/app-icon-512.png',
      appleTouchIcon: '/apple-touch-icon.png',
      backgroundColor: '#ffffff',
      themeColor: '#7b7ef5',
    },
    // 8190/5190, and why neither is 8080: apps/server/src/agent/loopback-guard.ts. A second Box on
    // one machine must never be one default away from the first - give it its own numbers here.
    server: { port: 8190, vitePort: 5190, viteDevUrl: null, dashboardUrl: null, vscodeRemoteHost: null },
    backup: { gcsBucket: null },
    background: { automation: false, chatAgent: false, relay: false },
    auth: { sessionSecret: null, tokenSecret: null },
    mcp: { url: null, token: null },
    http: { userAgent: 'Silkweave Box' },
    features: {}, workerdeck: null, workerdeckTokens: {}, accounts: {}, credentials: {}, agentProfiles: {},
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `$schema` and `_`-prefixed keys are for editors and notes; the parser never reads them. */
const isNote = (key: string): boolean => key === '$schema' || key.startsWith('_')

const refuse = (where: string, why: string): never => {
  throw new Error(`${where}: ${why}`)
}

/** Refuse a key the shape does not have: with `$schema` in the file, a typo is what it almost always is. */
function onlyKeys(raw: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(raw)) {
    if (isNote(key) || allowed.includes(key)) continue
    refuse(at, `unknown key ${JSON.stringify(key)} (allowed: ${allowed.join(', ')})`)
  }
}

/** A string. Trimmed, so an accidental trailing space is not a rename; blank only where a blank means something. */
function text(raw: Record<string, unknown>, key: string, at: string, fallback: string, allowEmpty = false): string {
  const v = raw[key]
  if (v === undefined) return fallback
  if (typeof v !== 'string' || (!allowEmpty && v.trim() === '')) return refuse(at, `${key} must be a non-empty string`)
  return v.trim()
}

/** A wordmark with no suffix, or no tagline, is a choice; a blank product name is a mistake. */
const BLANK_OK_BRAND_KEYS: readonly (keyof BoxBrand)[] = ['suffix', 'description']

/** An optional string; `null` and `""` both mean unset. */
function optionalText(raw: Record<string, unknown>, key: string, at: string): string | null {
  const v = raw[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return refuse(at, `${key} must be a string or null`)
  return v.trim() === '' ? null : v.trim()
}

function port(raw: Record<string, unknown>, key: string, at: string, fallback: number): number {
  const v = raw[key]
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 65535) return refuse(at, `${key} must be a port number (1-65535)`)
  return v
}

function flag(raw: Record<string, unknown>, key: string, at: string, fallback: boolean): boolean {
  const v = raw[key]
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') return refuse(at, `${key} must be true or false`)
  return v
}

/** A section that is absent reads as its defaults; one that is present must be an object. */
function section(raw: Record<string, unknown>, key: string, where: string): Record<string, unknown> | undefined {
  const v = raw[key]
  if (v === undefined) return undefined
  if (!isRecord(v)) return refuse(where, `${key} must be an object`)
  return v
}

/**
 * The identity block alone, strictly. The identity guards in box-config.ts key on THIS and nothing
 * else, so a mistake in `brand` or `server` can never read as a renamed agent.
 */
export function parseBoxAgent(raw: unknown, where: string): BoxAgent {
  const at = `${where} agent`
  const agent = raw as Partial<BoxAgent> | null
  if (!isRecord(agent) || typeof agent.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(agent.id) ||
      typeof agent.name !== 'string' || !agent.name.trim() || agent.name !== agent.name.trim() ||
      !['admin', 'member'].includes(agent.role ?? '')) {
    return refuse(where, 'requires agent: { id: lowercase slug, name: nonempty display name, role: "admin" or "member" }')
  }
  onlyKeys(agent, ['id', 'name', 'role'], at)
  return { id: agent.id, name: agent.name, role: agent.role as BoxAgent['role'] }
}

/**
 * Validate a parsed file against the shape. Every refusal names the key, because this file is
 * hand-edited and "the brand did not change" is not a message anyone can act on. Missing sections
 * and keys take their defaults; `agent` is validated by `parseBoxAgent` when present.
 */
export function parseBoxJson(raw: unknown, where = 'box.json'): BoxJson {
  if (!isRecord(raw)) return refuse(where, 'must contain a JSON object')
  const defaults = defaultBoxJson()
  onlyKeys(raw, ['agent', 'brand', 'server', 'backup', 'background', 'auth', 'mcp', 'http', 'features', 'workerdeck', 'workerdeckTokens', 'accounts', 'credentials', 'agentProfiles'], where)

  const agent = raw['agent'] === undefined ? defaults.agent : parseBoxAgent(raw['agent'], where)

  const brand = { ...defaults.brand }
  const b = section(raw, 'brand', where)
  if (b) {
    onlyKeys(b, BOX_BRAND_KEYS, `${where} brand`)
    for (const key of BOX_BRAND_KEYS) brand[key] = text(b, key, `${where} brand`, defaults.brand[key], BLANK_OK_BRAND_KEYS.includes(key))
  }

  const server = { ...defaults.server }
  const s = section(raw, 'server', where)
  if (s) {
    onlyKeys(s, ['port', 'vitePort', 'viteDevUrl', 'dashboardUrl', 'vscodeRemoteHost'], `${where} server`)
    server.port = port(s, 'port', `${where} server`, defaults.server.port)
    server.vitePort = port(s, 'vitePort', `${where} server`, defaults.server.vitePort)
    server.viteDevUrl = optionalText(s, 'viteDevUrl', `${where} server`)
    server.dashboardUrl = optionalText(s, 'dashboardUrl', `${where} server`)
    server.vscodeRemoteHost = optionalText(s, 'vscodeRemoteHost', `${where} server`)
  }

  const backup = { ...defaults.backup }
  const k = section(raw, 'backup', where)
  if (k) {
    onlyKeys(k, ['gcsBucket'], `${where} backup`)
    backup.gcsBucket = optionalText(k, 'gcsBucket', `${where} backup`)
  }

  const background = { ...defaults.background }
  const g = section(raw, 'background', where)
  if (g) {
    onlyKeys(g, ['automation', 'chatAgent', 'relay'], `${where} background`)
    background.automation = flag(g, 'automation', `${where} background`, defaults.background.automation)
    background.chatAgent = flag(g, 'chatAgent', `${where} background`, defaults.background.chatAgent)
    background.relay = flag(g, 'relay', `${where} background`, defaults.background.relay)
  }

  const auth = { ...defaults.auth }; const a = section(raw, 'auth', where)
  if (a) { onlyKeys(a, ['sessionSecret', 'tokenSecret'], `${where} auth`); auth.sessionSecret = optionalText(a, 'sessionSecret', `${where} auth`); auth.tokenSecret = optionalText(a, 'tokenSecret', `${where} auth`) }
  const mcp = { ...defaults.mcp }; const m = section(raw, 'mcp', where)
  if (m) { onlyKeys(m, ['url', 'token'], `${where} mcp`); mcp.url = optionalText(m, 'url', `${where} mcp`); mcp.token = optionalText(m, 'token', `${where} mcp`) }
  const http = { ...defaults.http }; const h = section(raw, 'http', where)
  if (h) { onlyKeys(h, ['userAgent'], `${where} http`); http.userAgent = text(h, 'userAgent', `${where} http`, defaults.http.userAgent) }
  const map = (key: string): Record<string, unknown> => {
    const v = raw[key]; if (v === undefined) return {}
    if (!isRecord(v)) return refuse(where, `${key} must be an object`)
    for (const name of Object.keys(v)) if (name === '__proto__' || name === 'constructor' || name === 'prototype') refuse(`${where} ${key}`, `unsafe key ${JSON.stringify(name)}`)
    return v
  }
  const features: Record<string, Record<string, unknown>> = {}
  for (const [name, value] of Object.entries(map('features'))) { if (!isRecord(value)) refuse(`${where} features`, `${name} must be an object`); features[name] = value as Record<string, unknown> }
  const workerdeckRaw = raw.workerdeck
  if (workerdeckRaw !== undefined && workerdeckRaw !== null && !isRecord(workerdeckRaw)) refuse(where, 'workerdeck must be an object or null')
  const workerdeckTokens: Record<string, string> = {}
  for (const [name, value] of Object.entries(map('workerdeckTokens'))) { if (typeof value !== 'string') refuse(`${where} workerdeckTokens`, `${name} must be a string`); workerdeckTokens[name] = value as string }
  const accounts: Record<string, unknown[]> = {}
  for (const [name, value] of Object.entries(map('accounts'))) { if (!Array.isArray(value)) refuse(`${where} accounts`, `${name} must be an array`); accounts[name] = value as unknown[] }
  const credentials: Record<string, Record<string, Record<string, string>>> = {}
  for (const [provider, value] of Object.entries(map('credentials'))) {
    if (!isRecord(value)) refuse(`${where} credentials`, `${provider} must be an object`)
    const channels: Record<string, Record<string, string>> = {}
    for (const [channel, fields] of Object.entries(value as Record<string, unknown>)) {
      if (!isRecord(fields)) refuse(`${where} credentials`, `${provider}.${channel} must be an object`)
      const out: Record<string, string> = {}
      for (const [key, field] of Object.entries(fields as Record<string, unknown>)) { if (typeof field !== 'string') refuse(`${where} credentials`, `${provider}.${channel}.${key} must be a string`); out[key] = field as string }
      channels[channel] = out
    }
    credentials[provider] = channels
  }
  const agentProfiles: Record<string, Record<string, string>> = {}
  for (const [user, profiles] of Object.entries(map('agentProfiles'))) {
    if (!isRecord(profiles)) refuse(`${where} agentProfiles`, `${user} must be an object`)
    const entry: Record<string, string> = {}
    for (const [engine, profile] of Object.entries(profiles as Record<string, unknown>)) {
      if (typeof profile !== 'string' || !profile.trim()) refuse(`${where} agentProfiles`, `${user}.${engine} must be a non-empty string`)
      entry[engine] = profile as string
    }
    agentProfiles[user] = entry
  }

  return { agent, brand, server, backup, background, auth, mcp, http, features, workerdeck: workerdeckRaw as Record<string, unknown> | null ?? null, workerdeckTokens, accounts, credentials, agentProfiles }
}

/** Parse a file's text, naming the file in the one error JSON.parse would otherwise leave vague. */
export function parseBoxJsonText(text: string, where: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    return refuse(where, `is not valid JSON - ${(error as Error).message}`)
  }
}

/**
 * Read and validate `file`, or return the defaults when it does not exist yet. Absence is normal:
 * a fresh clone has no `data/` until `bun install` writes this file, and typegen runs against an
 * empty throwaway directory. A file that exists and is wrong is never papered over.
 */
export function readBoxJsonFile(file: string, where = 'box.json'): BoxJson {
  if (!existsSync(file)) return defaultBoxJson()
  return parseBoxJson(parseBoxJsonText(readFileSync(file, 'utf8'), where), where)
}

function mergeConfig(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(next)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`box.json: unsafe key ${JSON.stringify(key)}`)
    const clean = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(clean)
      if (!isRecord(item)) return item
      const object: Record<string, unknown> = {}
      for (const [nested, child] of Object.entries(item)) {
        if (nested === '__proto__' || nested === 'constructor' || nested === 'prototype') throw new Error(`box.json: unsafe key ${JSON.stringify(nested)}`)
        object[nested] = clean(child)
      }
      return object
    }
    out[key] = isRecord(value) && isRecord(out[key]) ? mergeConfig(out[key] as Record<string, unknown>, value) : clean(value)
  }
  return out
}
export function readBoxConfig(root: string = process.cwd()): BoxJson {
  const files = [join(root, 'box.json'), join(root, 'box.local.json')].filter(existsSync)
  if (!files.length) return defaultBoxJson()
  const merged = files.reduce((base, file) => {
    const value = parseBoxJsonText(readFileSync(file, 'utf8'), file)
    if (!isRecord(value)) return refuse(file, 'must contain a JSON object')
    return mergeConfig(base, value)
  }, {} as Record<string, unknown>)
  return parseBoxJson(merged, 'box.json')
}
export function writeBoxLocal(root: string, patch: Record<string, unknown>): BoxJson {
  const local = join(root, 'box.local.json')
  const current = existsSync(local) ? parseBoxJsonText(readFileSync(local, 'utf8'), 'box.local.json') : {}
  if (!isRecord(current) || !isRecord(patch)) throw new Error('box.local.json: patch must be a JSON object')
  const next = mergeConfig(current, patch)
  const baseFile = join(root, 'box.json')
  const base = existsSync(baseFile) ? parseBoxJsonText(readFileSync(baseFile, 'utf8'), 'box.json') : {}
  if (!isRecord(base)) throw new Error('box.json: must contain a JSON object')
  parseBoxJson(mergeConfig(base, next), 'box.json')
  mkdirSync(root, { recursive: true })
  const temp = `${local}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, local)
  return readBoxConfig(root)
}

/** The text of a fresh file: the schema pointer first, then every section, so editing needs no lookup. */
export function boxJsonText(config: BoxJson = defaultBoxJson()): string {
  return `${JSON.stringify({ $schema: BOX_JSON_SCHEMA_REF, ...config }, null, 2)}\n`
}

/**
 * Create `file` with `config` (the defaults unless told otherwise) if and only if it does not
 * exist. Returns false when it was already there. `wx` keeps two processes from both winning.
 */
export function writeBoxJsonIfAbsent(file: string, config: BoxJson = defaultBoxJson()): boolean {
  mkdirSync(dirname(file), { recursive: true })
  try {
    writeFileSync(file, boxJsonText(config), { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}
