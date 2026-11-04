import { crc32, deflateRawSync } from 'node:zlib'

/** One file in an archive. `name` uses forward slashes and no leading slash. */
export interface ZipEntry {
  name: string
  data: Buffer | string
  modified?: Date
}

/** MS-DOS time and date, the only timestamps the local and central headers carry. */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * A plain zip archive (deflate, UTF-8 names, no zip64), enough for a support export of a few
 * megabytes that every operating system opens without extra tools. Entries over 4 GiB or more than
 * 65535 entries are refused rather than written as a broken archive.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > 0xffff) throw new Error('Too many zip entries')
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) throw new Error(`Invalid zip entry name: ${entry.name}`)
    const name = Buffer.from(entry.name, 'utf8')
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data
    const packed = deflateRawSync(raw)
    if (raw.length > 0xffffffff || packed.length > 0xffffffff || offset > 0xffffffff) throw new Error('Zip entry too large')
    const checksum = crc32(raw)
    const stamp = dosTime(entry.modified ?? new Date())
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed: deflate
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4) // made by: Unix, 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38) // regular file, owner read/write
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
