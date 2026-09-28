import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBoxStatusStream } from './box-status-stream.js'

// fs.watchFile takes its baseline stat asynchronously after registration: a write that lands before
// it becomes the baseline and never fires (the stream only recovers on its 15 s heartbeat). Wait
// past one 500 ms poll after an open() that starts the watcher before writing what it must see.
const watcherReady = () => new Promise(resolve => setTimeout(resolve, 750))

function response() {
  const frames: string[] = []
  const res = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    write: vi.fn((frame: string) => { frames.push(frame); return true }),
    destroy: vi.fn(() => { res.emit('close'); return res }),
  })
  return { res: res as unknown as ServerResponse, frames }
}

it('broadcasts atomic state changes to all tabs, reconnects with current state, and cleans up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'box-status-'))
  const file = join(dir, 'control.json')
  const save = (maintenance: boolean) => {
    writeFileSync(`${file}.tmp`, JSON.stringify({ maintenance, secret: 'never broadcast' }))
    renameSync(`${file}.tmp`, file)
  }
  save(false)
  const feed = createBoxStatusStream(file, () => JSON.parse(readFileSync(file, 'utf8')))
  const first = response(), second = response(), reconnect = response()
  try {
    feed.open(first.res)
    feed.open(second.res)
    await watcherReady()
    expect(first.frames.join('')).toContain('data: {"maintenance":false}')
    expect(first.frames.join('')).not.toContain('secret')
    save(true)
    await vi.waitFor(() => expect(first.frames.at(-1)).toBe('data: {"maintenance":true}\n\n'), { timeout: 3000 })
    expect(second.frames.at(-1)).toBe(first.frames.at(-1))
    first.res.destroy()
    save(false)
    await vi.waitFor(() => expect(second.frames.at(-1)).toBe('data: {"maintenance":false}\n\n'), { timeout: 3000 })
    expect(first.frames.at(-1)).toBe('data: {"maintenance":true}\n\n')
    second.res.destroy()
    save(true)
    feed.open(reconnect.res)
    expect(reconnect.frames.join('')).toContain('data: {"maintenance":true}')
    await watcherReady()
    writeFileSync(file, 'invalid')
    await vi.waitFor(() => expect(reconnect.res.destroy).toHaveBeenCalled(), { timeout: 3000 })
  } finally { feed.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('heartbeats unchanged state and disconnects slow clients without buffering', () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(tmpdir(), 'box-status-'))
  const feed = createBoxStatusStream(join(dir, 'control.json'), () => ({ maintenance: false }))
  const client = response()
  try {
    feed.open(client.res)
    vi.advanceTimersByTime(15_000)
    expect(client.frames.at(-1)).toBe(': keepalive\n\n')
    vi.mocked(client.res.write).mockReturnValue(false)
    vi.advanceTimersByTime(15_000)
    expect(client.res.destroy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally { feed.close(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers() }
})
