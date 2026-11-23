// A minimal ustar + gzip writer and reader for database snapshots (restore-point.ts). Node's zlib
// does the compression; nothing is spawned. The writer streams files straight from a live data
// directory into the archive: a file that vanishes before it is opened is skipped, and one that
// shrinks while it is read is padded with zeros to the size its header announced (WAL replay
// rewrites every page changed during the backup, as with pg_basebackup). The reader accepts only
// what the writer produces: regular files and directories under relative paths.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { Transform } from 'node:stream'
import { finished } from 'node:stream/promises'
import { createGunzip, createGzip, constants as zlib } from 'node:zlib'

const BLOCK = 512
const CHUNK = 1024 * 1024
/** Largest size an 11-digit octal field holds (PostgreSQL relation segments stay at 1 GB). */
const MAX_SIZE = 8 ** 11 - 1

export interface ArchiveSummary {
  /** Compressed bytes written. */
  bytes: number
  /** sha256 of the compressed archive. */
  sha256: string
  /** Regular files and directories written. */
  entries: number
  /** Uncompressed file content written. */
  dataBytes: number
}

function octal(buf: Buffer, offset: number, width: number, value: number): void {
  buf.write(value.toString(8).padStart(width - 1, '0'), offset, width - 1, 'ascii')
  buf[offset + width - 1] = 0
}

/** Split `name` into ustar's prefix (155) and name (100) fields at a `/`. */
function splitName(name: string): { prefix: string; base: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', base: name }
  for (let i = name.indexOf('/'); i !== -1; i = name.indexOf('/', i + 1)) {
    const prefix = name.slice(0, i), base = name.slice(i + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100 && base) return { prefix, base }
  }
  throw new Error(`path too long for the archive: ${name}`)
}

function header(name: string, type: '0' | '5', size: number, mode: number, mtime: number): Buffer {
  if (size > MAX_SIZE) throw new Error(`${name} is larger than the archive format allows`)
  const h = Buffer.alloc(BLOCK)
  const { prefix, base } = splitName(name)
  h.write(base, 0, 100, 'utf8')
  octal(h, 100, 8, mode & 0o7777)
  octal(h, 108, 8, 0)
  octal(h, 116, 8, 0)
  octal(h, 124, 12, size)
  octal(h, 136, 12, Math.max(0, Math.floor(mtime)))
  h.fill(0x20, 148, 156)
  h.write(type, 156, 1, 'ascii')
  h.write('ustar\u000000', 257, 8, 'ascii')
  h.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
  h[154] = 0
  h[155] = 0x20
  return h
}

/** A gzip-compressed tar archive written entry by entry, with backpressure. */
export class TarGzWriter {
  private readonly gzip = createGzip({ level: zlib.Z_BEST_SPEED + 2 })
  private readonly hash = createHash('sha256')
  private readonly out
  private compressed = 0
  private entries = 0
  private dataBytes = 0

  constructor(readonly file: string) {
    const count = new Transform({
      transform: (chunk: Buffer, _enc, done) => { this.hash.update(chunk); this.compressed += chunk.length; done(null, chunk) },
    })
    this.out = createWriteStream(file, { mode: 0o600, flags: 'wx' })
    this.gzip.pipe(count).pipe(this.out)
  }

  private async write(chunk: Buffer): Promise<void> {
    if (!this.gzip.write(chunk)) await new Promise<void>((resolve, reject) => {
      const fail = (e: Error) => { this.gzip.off('drain', ok); reject(e) }
      const ok = () => { this.gzip.off('error', fail); resolve() }
      this.gzip.once('drain', ok)
      this.gzip.once('error', fail)
    })
  }

  async addDir(name: string, mode = 0o700, mtime = Date.now() / 1000): Promise<void> {
    await this.write(header(name.endsWith('/') ? name : `${name}/`, '5', 0, mode, mtime))
    this.entries++
  }

  async addBuffer(name: string, data: Buffer, mode = 0o600, mtime = Date.now() / 1000): Promise<void> {
    await this.write(header(name, '0', data.length, mode, mtime))
    await this.write(data)
    await this.pad(data.length)
    this.entries++
    this.dataBytes += data.length
  }

  /**
   * Add the file at `path` as `name`. Returns false when the file no longer exists (skipped). The
   * size is taken when the file is opened; later growth is not read, shrinkage is zero-padded.
   */
  async addFile(name: string, path: string): Promise<boolean> {
    let fh: FileHandle
    try { fh = await open(path, 'r') } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
    try {
      const st = await fh.stat()
      if (!st.isFile()) return false
      const size = st.size
      await this.write(header(name, '0', size, st.mode, st.mtimeMs / 1000))
      let done = 0
      while (done < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - done))
        const { bytesRead } = await fh.read(buf, 0, buf.length, done)
        if (bytesRead === 0) { await this.write(Buffer.alloc(size - done)); done = size; break }
        await this.write(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead))
        done += bytesRead
      }
      await this.pad(size)
      this.entries++
      this.dataBytes += size
      return true
    } finally { await fh.close() }
  }

  private async pad(size: number): Promise<void> {
    const rest = size % BLOCK
    if (rest) await this.write(Buffer.alloc(BLOCK - rest))
  }

  /** End the archive (two zero blocks), flush and close it. */
  async finish(): Promise<ArchiveSummary> {
    await this.write(Buffer.alloc(BLOCK * 2))
    this.gzip.end()
    await finished(this.out)
    return { bytes: this.compressed, sha256: this.hash.digest('hex'), entries: this.entries, dataBytes: this.dataBytes }
  }

  /** Abandon the archive (the caller removes the file). */
  async abort(): Promise<void> {
    this.gzip.destroy()
    this.out.destroy()
    await finished(this.out).catch(() => {})
  }
}

/** Pulls exact byte counts out of a chunk stream. */
class ByteReader {
  private buf: Buffer = Buffer.alloc(0)
  private readonly it: AsyncIterator<Buffer>
  constructor(source: AsyncIterable<Buffer>) { this.it = source[Symbol.asyncIterator]() }

  /** Up to `max` bytes (at least one) or null at the end of the stream. */
  async some(max: number): Promise<Buffer | null> {
    if (!this.buf.length) {
      const next = await this.it.next()
      if (next.done) return null
      this.buf = next.value
    }
    const out = this.buf.subarray(0, max)
    this.buf = this.buf.subarray(out.length)
    return out
  }

  async exactly(n: number): Promise<Buffer | null> {
    const parts: Buffer[] = []
    let got = 0
    while (got < n) {
      const part = await this.some(n - got)
      if (!part) { if (got === 0) return null; throw new Error('archive ends inside an entry (truncated)') }
      parts.push(part)
      got += part.length
    }
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts)
  }
}

function field(h: Buffer, offset: number, width: number): string {
  const raw = h.subarray(offset, offset + width)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? width : end).toString('utf8')
}

function readOctal(h: Buffer, offset: number, width: number): number {
  const text = field(h, offset, width).trim()
  if (!/^[0-7]*$/.test(text)) throw new Error('archive header has an invalid number field')
  return text ? Number.parseInt(text, 8) : 0
}

/** A relative path that stays inside the destination. */
function safePath(name: string): string {
  const n = normalize(name).replace(/[\\/]+$/, '')
  if (!n || n === '.' || n.startsWith('/') || n.split(sep).includes('..')) throw new Error(`archive entry "${name}" points outside the destination`)
  return n
}

/**
 * Unpack the archive at `file` into `dest` (created when missing). Refuses anything but regular
 * files and directories, absolute paths and `..`; a damaged or truncated archive throws.
 */
export async function extractTarGz(file: string, dest: string): Promise<{ entries: number }> {
  mkdirSync(dest, { recursive: true, mode: 0o700 })
  const gunzip = createGunzip()
  const input = createReadStream(file)
  input.on('error', (e) => gunzip.destroy(e))
  const source = input.pipe(gunzip)
  const reader = new ByteReader(source as AsyncIterable<Buffer>)
  let entries = 0
  try {
    for (;;) {
      const h = await reader.exactly(BLOCK)
      if (!h) throw new Error('archive ends without its end marker (truncated)')
      if (h.every((b) => b === 0)) break
      let sum = 0
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!
      if (sum !== readOctal(h, 148, 8)) throw new Error('archive header checksum mismatch (damaged)')
      if (field(h, 257, 6) !== 'ustar') throw new Error('not a ustar archive')
      const prefix = field(h, 345, 155), base = field(h, 0, 100)
      const name = safePath(prefix ? `${prefix}/${base}` : base)
      const type = String.fromCharCode(h[156]!)
      const size = readOctal(h, 124, 12)
      const mode = readOctal(h, 100, 8) & 0o777
      const target = join(dest, name)
      if (type === '5') {
        mkdirSync(target, { recursive: true, mode: mode || 0o700 })
      } else if (type === '0' || type === '\0') {
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        const fh = await open(target, 'wx', mode || 0o600)
        try {
          let left = size
          while (left > 0) {
            const part = await reader.some(Math.min(left, CHUNK))
            if (!part) throw new Error(`archive ends inside ${name} (truncated)`)
            await fh.write(part)
            left -= part.length
          }
        } finally { await fh.close() }
        const rest = size % BLOCK
        if (rest && !(await reader.exactly(BLOCK - rest))) throw new Error('archive ends inside padding (truncated)')
      } else {
        throw new Error(`archive entry ${name} has unsupported type "${type}"`)
      }
      entries++
    }
    // Drain: gunzip verifies the trailer (CRC and length) only at the end of the stream.
    while (await reader.some(CHUNK)) { /* trailing zero blocks */ }
  } finally {
    input.destroy()
    source.destroy()
  }
  return { entries }
}
