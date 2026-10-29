import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBoxStatusStream, type StatusClient } from './box-status-stream.js'

// fs.watchFile takes its baseline stat asynchronously after registration: a write that lands before
// it becomes the baseline and never fires (the stream only recovers on its 15 s heartbeat). Wait
// past one 500 ms poll after an open() that starts the watcher before writing what it must see.
const watcherReady = () => new Promise(resolve => setTimeout(resolve, 750))

function socket() {
  const frames: string[] = []
  const client = Object.assign(new EventEmitter(), {
    bufferedAmount: 0,
    send: vi.fn((frame: string) => { frames.push(frame) }),
    ping: vi.fn(),
    terminate: vi.fn(() => { client.emit('close') }),
  })
  return { client: client as unknown as StatusClient & EventEmitter & { bufferedAmount: number }, frames, ping: client.ping, terminate: client.terminate }
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
  const first = socket(), second = socket(), reconnect = socket()
  try {
    feed.open(first.client)
    feed.open(second.client)
    await watcherReady()
    expect(first.frames).toEqual(['{"maintenance":false}'])
    save(true)
    await vi.waitFor(() => expect(first.frames.at(-1)).toBe('{"maintenance":true}'), { timeout: 3000 })
    expect(second.frames.at(-1)).toBe(first.frames.at(-1))
    first.client.terminate()
    save(false)
    await vi.waitFor(() => expect(second.frames.at(-1)).toBe('{"maintenance":false}'), { timeout: 3000 })
    expect(first.frames.at(-1)).toBe('{"maintenance":true}')
    second.client.terminate()
    save(true)
    feed.open(reconnect.client)
    expect(reconnect.frames).toEqual(['{"maintenance":true}'])
    await watcherReady()
    writeFileSync(file, 'invalid')
    await vi.waitFor(() => expect(reconnect.terminate).toHaveBeenCalled(), { timeout: 3000 })
  } finally { feed.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('pings on the heartbeat, drops clients that stop answering or fall behind, and stops when empty', () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(tmpdir(), 'box-status-'))
  let maintenance = false
  const feed = createBoxStatusStream(join(dir, 'control.json'), () => ({ maintenance }))
  const quiet = socket(), slow = socket(), healthy = socket()
  try {
    feed.open(quiet.client)
    feed.open(slow.client)
    feed.open(healthy.client)
    vi.advanceTimersByTime(15_000)
    expect(quiet.ping).toHaveBeenCalledTimes(1)
    slow.client.emit('pong')
    healthy.client.emit('pong')
    vi.advanceTimersByTime(15_000)
    expect(quiet.terminate).toHaveBeenCalled()
    expect(slow.terminate).not.toHaveBeenCalled()
    slow.client.bufferedAmount = 1024 * 1024
    maintenance = true
    feed.refresh()
    expect(slow.terminate).toHaveBeenCalled()
    expect(healthy.frames.at(-1)).toBe('{"maintenance":true}')
    expect(vi.getTimerCount()).toBe(1)
    healthy.client.terminate()
    expect(vi.getTimerCount()).toBe(0)
  } finally { feed.close(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers() }
})
