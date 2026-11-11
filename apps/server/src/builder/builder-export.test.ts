import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { SessionEvent } from '@workerdeck/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSessionExport, engineEvents, transcriptMarkdown } from './builder-export.js'
import { createBuilderJournal, readJournal } from './builder-journal.js'
import { readTurns, recordedSessions, recordTurn } from './builder-turns.js'
import { createRedactor, keysOnly, REDACTED, secretValues } from './redact.js'
import { createZip } from './zip.js'

/** Reads back a zip written by createZip (central directory, deflate entries). */
function unzip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const localName = zip.readUInt16LE(offset + 26)
    const data = zip.subarray(offset + 30 + localName, offset + 30 + localName + size)
    files.set(name, inflateRawSync(data).toString('utf8'))
    at += 46 + nameLength
  }
  return files
}

const dirs: string[] = []
const scratch = (): string => { const dir = mkdtempSync(join(tmpdir(), 'box-export-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const event = (seq: number, body: Record<string, unknown>): SessionEvent => ({ seq, ts: 1_793_700_000_000 + seq * 1000, ...body }) as unknown as SessionEvent

describe('createZip', () => {
  it('writes entries a standard reader can list and inflate', () => {
    const zip = createZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.json', data: '{"x":1}\n' }])
    expect([...unzip(zip)]).toEqual([['a.txt', 'hello'], ['dir/b.json', '{"x":1}\n']])
    const dir = scratch()
    writeFileSync(join(dir, 'test.zip'), zip)
    let listing = ''
    try { listing = execFileSync('unzip', ['-l', join(dir, 'test.zip')], { encoding: 'utf8' }) } catch { return /* no unzip on this host */ }
    expect(listing).toContain('dir/b.json')
  })

  it('refuses names that escape the archive', () => {
    expect(() => createZip([{ name: '../x', data: '' }])).toThrow()
    expect(() => createZip([{ name: '/abs', data: '' }])).toThrow()
  })
})

describe('redactor', () => {
  it('removes known values, token patterns and secret-named keys, and keeps names readable', () => {
    const local = { auth: { token: 'short-but-secret-1' }, workerdeck: { profiles: [{ name: 'toby:claude', home: '/Users/toby/.claude' }] }, registry: { url: 'https://registry.example' }, owner: 'Wb3kQ9xTz1Lm8Pq2Rs7Uv4Yh' }
    const known = secretValues(local)
    expect(known).toContain('short-but-secret-1')
    expect(known).toContain('Wb3kQ9xTz1Lm8Pq2Rs7Uv4Yh')
    expect(known).not.toContain('toby:claude')
    expect(known).not.toContain('/Users/toby/.claude')
    const redact = createRedactor(known)
    const text = redact.text([
      'profile toby:claude used token Wb3kQ9xTz1Lm8Pq2Rs7Uv4Yh',
      'Authorization: Bearer abcdefghijklmnop123',
      // Fake keys, assembled so secret scanners do not flag the fixture.
      `key ${'sk-' + 'ant-api03-ABCDEFGHIJKLMNOP'} and ${'ghp' + '_ABCDEFGHIJKLMNOPQRSTUVWX'}`,
      'link http://localhost:8190/login/bl2.AaGkFWClAA27oHRvYnk.ev2LYfCPvFpxlW_QEVhPRu0-6MY',
      'CLAUDE_CODE_OAUTH_TOKEN=sk-oat-0123456789abcdef',
      'cookie box_session=abc123def456',
      'git https://user:hunter22@github.com/x/y.git',
    ].join('\n'))
    expect(text).toContain('toby:claude')
    for (const secret of ['Wb3kQ9xTz1Lm8Pq2Rs7Uv4Yh', 'abcdefghijklmnop123', 'sk-ant-api03', 'ghp_ABCD', 'bl2.AaGk', '0123456789abcdef', 'abc123def456', 'hunter22']) expect(text).not.toContain(secret)
    expect(redact.value({ password: 'x', nested: { apiKey: 'y', inputTokens: 12, note: 'fine' } })).toEqual({ password: REDACTED, nested: { apiKey: REDACTED, inputTokens: 12, note: 'fine' } })
  })

  it('reduces a config to its key names', () => {
    expect(keysOnly({ a: 'secret', b: { c: 1, d: [true] }, e: null })).toEqual({ a: '<string>', b: { c: '<number>', d: ['<boolean>'] }, e: 'null' })
  })
})

describe('journal and turns', () => {
  it('keeps lifecycle events and failures, drops request noise, and reads a time window', () => {
    const dir = scratch()
    const journal = createBuilderJournal(dir)
    journal.diagnostic({ time: '2026-11-04T01:00:00.000Z', pid: 1, component: 'lifecycle', event: 'app.spawn', childPid: 2 })
    journal.diagnostic({ time: '2026-11-04T01:00:01.000Z', pid: 1, component: 'supervisor', event: 'http.finish', status: 200, durationMs: 3 })
    journal.diagnostic({ time: '2026-11-04T01:00:02.000Z', pid: 1, component: 'supervisor', event: 'http.finish', status: 502, durationMs: 3 })
    journal.output('app', 'warn', 'Error: boom')
    journal.close()
    const entries = readJournal(dir, new Date('2026-11-04T00:59:00.000Z'))
    expect(entries.map(entry => entry.event ?? entry.text)).toEqual(['app.spawn', 'http.finish', 'Error: boom'])
    expect(entries[2]!.level).toBe('error')
    expect(readJournal(dir, new Date('2026-11-04T01:00:01.500Z')).map(entry => entry.event ?? entry.text)).toEqual(['http.finish', 'Error: boom'])
  })

  it('records the checkout after a turn and lists recorded sessions', async () => {
    const dir = scratch()
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeFileSync(join(repo, 'new.txt'), 'x')
    const record = await recordTurn(repo, dir, 'session-1', { seq: 7, subtype: 'success', durationMs: 1200, totalCostUsd: 0.5 }, { engine: 'claude', profile: 'p', model: 'm', engineSessionId: 'e-1' })
    expect(record.status).toEqual(['?? new.txt'])
    expect(readTurns(dir, 'session-1')).toHaveLength(1)
    expect(recordedSessions(dir).map(entry => entry.id)).toEqual(['session-1'])
    await expect(recordTurn(repo, dir, '../x', { seq: 1, subtype: 'success', durationMs: 1 }, { engine: null, profile: null, model: null, engineSessionId: null })).rejects.toThrow()
  })
})

describe('buildSessionExport', () => {
  it('bundles transcript, turns, journal and config without secret values', async () => {
    const root = scratch()
    const instance = join(root, 'data')
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, 'box.json'), JSON.stringify({ brand: { name: 'Test Box' }, recipes: { reminders: { powerups: [] } } }))
    writeFileSync(join(root, 'box.local.json'), JSON.stringify({ auth: { token: 'Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg' } }))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs/UPSTREAM.md'), 'Latest core refresh: Stack commit `e06a4aaedcf2162d37a154ebc67e4e284692be14` (2026-11-04)\n')
    await recordTurn(root, instance, 'sess-1', { seq: 4, subtype: 'success', durationMs: 900 }, { engine: 'claude', profile: 'toby:claude', model: 'opus', engineSessionId: 'eng-1' })
    const journal = createBuilderJournal(instance)
    journal.report('info', 'Builder ready')
    journal.close()
    const events = [
      event(1, { type: 'user_message', parentToolUseId: null, message: { role: 'user', content: 'Adapt reminders, my token is Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg' } }),
      event(2, { type: 'stream_delta', event: { type: 'x' }, parentToolUseId: null, uuid: 'u' }),
      event(3, { type: 'assistant_message', parentToolUseId: null, uuid: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the recipe.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'box verify' } }] } }),
      event(4, { type: 'turn_result', subtype: 'success', isError: false, durationMs: 900, numTurns: 2, totalCostUsd: 0.1 }),
    ]
    const exported = buildSessionExport({
      root, instanceDir: instance, sessionId: 'sess-1', info: null, startedAt: new Date(Date.now() - 60_000).toISOString(),
      events, conversations: [], verification: { status: 'passed' }, application: { status: 'running' }, now: new Date('2026-11-04T02:00:00.000Z'),
    })
    expect(exported.fileName).toBe('builder-session-20261104-0200-sess-1.zip')
    const files = unzip(exported.zip)
    expect([...files.keys()]).toEqual(['manifest.json', 'README.md', 'transcript.md', 'transcript.ndjson', 'turns.ndjson', 'journal.ndjson', 'verification.json', 'config/box.json', 'config/box.local.keys.json', 'box/UPSTREAM.md'])
    expect(exported.files.map(file => file.name)).toEqual([...files.keys()])
    const all = [...files.values()].join('\n')
    expect(all).not.toContain('Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg')
    expect(files.get('transcript.md')).toContain('**Tool: Bash**')
    expect(files.get('transcript.ndjson')!.split('\n').filter(Boolean)).toHaveLength(3)
    expect(files.get('config/box.local.keys.json')).toContain('"token": "<string>"')
    const manifest = JSON.parse(files.get('manifest.json')!) as { box: { stackCore: string; recipes: unknown }; session: { engineSessionId: string; status: string } }
    expect(manifest.box.stackCore).toBe('e06a4aaedcf2162d37a154ebc67e4e284692be14')
    expect(manifest.box.recipes).toEqual({ reminders: { powerups: [] } })
    expect(manifest.session).toMatchObject({ engineSessionId: 'eng-1', status: 'ended' })
    expect(files.get('journal.ndjson')).toContain('Builder ready')
  })

  it('renders tool results and turn outcomes in the readable transcript', () => {
    const md = transcriptMarkdown([
      event(1, { type: 'user_message', parentToolUseId: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok', is_error: true }] } }),
      event(2, { type: 'turn_result', subtype: 'error_during_execution', isError: true, durationMs: 2000, numTurns: 1, totalCostUsd: 0, errors: ['boom'] }),
    ])
    expect(md).toContain('**Result (error)**')
    expect(md).toContain('errors: boom')
  })

  it('exports an ended Claude session from its own transcript, with a readable transcript.md', async () => {
    const root = scratch()
    const instance = join(root, 'data')
    const home = join(root, 'claude-home')
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, 'box.local.json'), JSON.stringify({ auth: { token: 'Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg' } }))
    await recordTurn(root, instance, 'sess-2', { seq: 2, subtype: 'success', durationMs: 500 }, { engine: 'claude', profile: 'toby:claude', model: 'opus', engineSessionId: 'eng-claude-1' })
    const project = join(home, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'eng-claude-1.jsonl'), [
      { type: 'user', timestamp: '2026-11-04T01:00:00.000Z', message: { role: 'user', content: 'Why does Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg fail?' } },
      { type: 'assistant', timestamp: '2026-11-04T01:00:05.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'box verify' } }] } },
      { type: 'attachment', timestamp: '2026-11-04T01:00:06.000Z' },
    ].map(line => JSON.stringify(line)).join('\n'))
    const files = unzip(buildSessionExport({ root, instanceDir: instance, sessionId: 'sess-2', info: null, events: null, conversations: [], verification: null, application: null, profileHome: home }).zip)
    expect(files.get('transcript.md')).toContain('### User')
    expect(files.get('transcript.md')).toContain('**Tool: Bash**')
    expect(files.get('engine-transcript.jsonl')!.split('\n').filter(Boolean)).toHaveLength(3)
    expect([...files.values()].join('\n')).not.toContain('Zq8Lw3Nv5Tb7Yc2Md9Kf4Hg')
  })

  it('exports a session killed mid-turn from the record written when its turn started', async () => {
    const root = scratch()
    const instance = join(root, 'data')
    const home = join(root, 'claude-home')
    execFileSync('git', ['init', '-q'], { cwd: root })
    await recordTurn(root, instance, 'sess-cut', { seq: 3, subtype: 'started', durationMs: 0 }, { engine: 'claude', profile: 'toby:claude', model: 'opus', engineSessionId: 'eng-cut-1' })
    expect(recordedSessions(instance).map(entry => entry.id)).toContain('sess-cut')
    const project = join(home, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'eng-cut-1.jsonl'), JSON.stringify({ type: 'user', timestamp: '2026-11-11T02:07:00.000Z', message: { role: 'user', content: 'Adapt artifacts' } }))
    const exported = buildSessionExport({ root, instanceDir: instance, sessionId: 'sess-cut', info: null, events: null, conversations: [], verification: null, application: null, profileHome: home })
    const files = unzip(exported.zip)
    expect(files.get('transcript.md')).toContain('Adapt artifacts')
    expect(JSON.parse(files.get('manifest.json')!).session.numTurns).toBe(0)
  })

  it('exports an ended Codex session from its rollout file', async () => {
    const root = scratch()
    const instance = join(root, 'data')
    const home = join(root, 'codex-home')
    const thread = '01a01885-e3e1-7760-8414-dbb2ebd494ee'
    execFileSync('git', ['init', '-q'], { cwd: root })
    await recordTurn(root, instance, 'sess-3', { seq: 2, subtype: 'success', durationMs: 500 }, { engine: 'codex', profile: 'toby:codex', model: 'gpt', engineSessionId: thread })
    mkdirSync(join(home, 'sessions/2026/11/04'), { recursive: true })
    const item = (timestamp: string, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp, type, payload })
    writeFileSync(join(home, `sessions/2026/11/04/rollout-2026-11-04T01-00-00-${thread}.jsonl`), [
      item('2026-11-04T01:00:00.000Z', 'session_meta', { id: thread }),
      item('2026-11-04T01:00:00.000Z', 'event_msg', { type: 'task_started' }),
      item('2026-11-04T01:00:00.000Z', 'response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>' }] }),
      item('2026-11-04T01:00:00.000Z', 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }, { type: 'input_text', text: 'Adapt reminders' }] }),
      item('2026-11-04T01:00:02.000Z', 'response_item', { type: 'function_call', name: 'shell', arguments: '{"command":["ls"]}', call_id: 'c1' }),
      item('2026-11-04T01:00:03.000Z', 'response_item', { type: 'function_call_output', call_id: 'c1', output: 'features' }),
      item('2026-11-04T01:00:04.000Z', 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }),
      item('2026-11-04T01:00:05.000Z', 'event_msg', { type: 'task_complete', duration_ms: 5000 }),
    ].join('\n'))
    const exported = buildSessionExport({ root, instanceDir: instance, sessionId: 'sess-3', info: null, events: null, conversations: [], verification: null, application: null, profileHome: home })
    const files = unzip(exported.zip)
    const md = files.get('transcript.md')!
    expect(md).toContain('Adapt reminders')
    expect(md).not.toContain('environment_context')
    expect(md).not.toContain('permissions instructions')
    expect(md).toContain('**Tool: shell**')
    expect(md).toContain('features')
    expect(md).toContain('### Assistant')
    expect(md).toContain('*Turn ended: success, 5s, 1 steps*')
    expect(exported.files.find(file => file.name === 'engine-transcript.jsonl')?.description).toBe('Codex transcript of the ended session')
  })

  it('reads Claude sidechains as subagent work', () => {
    const md = transcriptMarkdown(engineEvents({ engine: 'claude', text: JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-11-04T01:00:00.000Z', message: { content: [{ type: 'text', text: 'Searching.' }] } }) }))
    expect(md).toContain('### Assistant (subagent)')
  })
})
