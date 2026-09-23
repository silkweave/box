import { createServer } from 'node:http'
import { lstatSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, readResponse, replaceImages } from '../builder-browser.ts'

test('browser command parsing requires a session and a known operation', () => {
  assert.throws(() => parseArgs(['snapshot']), /session id is required/)
  assert.throws(() => parseArgs(['--session', 's', 'unknown']), /Unknown.*operation/)
  assert.throws(() => parseArgs(['--session', 's', 'type', '{"ref":']), /valid UTF-8 JSON/)
  assert.deepEqual(parseArgs(['--session', 's', 'snapshot']), { sessionId: 's', operation: 'snapshot', params: {} })
})

test('browser Unix HTTP errors become useful CLI errors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-browser-cli-'))
  const socket = join(directory, 'browser.sock')
  const server = createServer((_request, response) => {
    response.writeHead(403, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ message: 'No browser grant is active' }))
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve) })
    await assert.rejects(readResponse(socket, '{}'), /No browser grant is active/)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

test('browser screenshot output is a private PNG path and rejects symlink directories', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'builder-browser-output-'))
  const repositoryDocs = join(repositoryRoot, '_docs')
  const browserDirectory = join(repositoryDocs, 'browser')
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
  try {
    const output = replaceImages({ image: { dataUrl: `data:image/png;base64,${png}`, width: 1 } }, repositoryRoot) as { image: { dataUrl?: string; path: string } }
    assert.equal(output.image.dataUrl, undefined)
    assert.equal(readFileSync(output.image.path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal((lstatSync(output.image.path).mode & 0o777), 0o600)
    unlinkSync(output.image.path)
    rmSync(browserDirectory, { recursive: true, force: true })

    const outside = mkdtempSync(join(tmpdir(), 'builder-browser-target-'))
    try {
      symlinkSync(outside, browserDirectory)
      assert.throws(() => replaceImages({ image: { dataUrl: `data:image/png;base64,${png}` } }, repositoryRoot), /symlink/)
      unlinkSync(browserDirectory)
    } finally { rmSync(outside, { recursive: true, force: true }) }
    assert.throws(() => replaceImages({ image: { dataUrl: `data:image/png;base64,${Buffer.from('not-png').toString('base64')}` } }, repositoryRoot), /invalid PNG/)
  } finally { rmSync(repositoryRoot, { recursive: true, force: true }) }
})
