// The snapshot archive format (tarball.ts): a round trip keeps paths, content and modes; damaged,
// truncated and escaping archives are refused.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractTarGz, TarGzWriter } from './tarball.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'box-tarball-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('tarball', () => {
  it('round-trips directories, files, long paths and modes', async () => {
    const src = join(root, 'src')
    mkdirSync(src)
    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7)
    writeFileSync(join(src, 'big'), big)
    writeFileSync(join(src, 'small'), 'hello\n', { mode: 0o640 })
    const long = `${'d'.repeat(120)}/${'f'.repeat(90)}`
    const w = new TarGzWriter(join(root, 'a.tar.gz'))
    await w.addDir('top')
    await w.addFile('top/big', join(src, 'big'))
    await w.addFile('top/small', join(src, 'small'))
    expect(await w.addFile('top/gone', join(src, 'missing'))).toBe(false)
    await w.addBuffer(`top/${long}`, Buffer.from('deep'))
    await w.addDir('top/empty')
    const summary = await w.finish()
    expect(summary).toMatchObject({ entries: 5, dataBytes: big.length + 6 + 4, bytes: statSync(join(root, 'a.tar.gz')).size })

    const out = join(root, 'out')
    expect(await extractTarGz(join(root, 'a.tar.gz'), out)).toEqual({ entries: 5 })
    expect(readFileSync(join(out, 'top', 'big')).equals(big)).toBe(true)
    expect(readFileSync(join(out, 'top', 'small'), 'utf8')).toBe('hello\n')
    expect(statSync(join(out, 'top', 'small')).mode & 0o777).toBe(0o640)
    expect(readFileSync(join(out, 'top', long), 'utf8')).toBe('deep')
    expect(statSync(join(out, 'top', 'empty')).isDirectory()).toBe(true)
  })

  it('refuses a truncated archive and an entry that escapes the destination', async () => {
    const w = new TarGzWriter(join(root, 'a.tar.gz'))
    await w.addBuffer('x/file', Buffer.alloc(100_000, 1))
    await w.finish()
    const whole = readFileSync(join(root, 'a.tar.gz'))
    writeFileSync(join(root, 'cut.tar.gz'), whole.subarray(0, whole.length - 40))
    await expect(extractTarGz(join(root, 'cut.tar.gz'), join(root, 'cut'))).rejects.toThrow()

    const evil = new TarGzWriter(join(root, 'evil.tar.gz'))
    await evil.addBuffer('../outside', Buffer.from('x'))
    await evil.finish()
    await expect(extractTarGz(join(root, 'evil.tar.gz'), join(root, 'evil'))).rejects.toThrow(/outside the destination/)

    writeFileSync(join(root, 'junk.tar.gz'), gzipSync(Buffer.alloc(512, 0x41)))
    await expect(extractTarGz(join(root, 'junk.tar.gz'), join(root, 'junk'))).rejects.toThrow(/checksum|ustar|invalid number/)
  })
})
