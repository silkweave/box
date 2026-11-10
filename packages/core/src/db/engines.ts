// The two database engines a Box can run, and where their binaries come from.
//
// pgrust (the default) is the publisher's checksummed release tarball, unpacked into
// `data/engines/` (disposable: never backed up, fetched again when missing). It bundles pgvector.
// Native PostgreSQL is installed on the host by its package manager (`box setup` offers the
// command); the Box resolves it as ONE installation: a server binary, that installation's own
// `pg_config` and its extension directory, never pieces from different places. The client tools
// (`pg_dump`, `pg_restore`) come from the host too, for both engines, and are checked against the
// actual servers they talk to.
//
// Accepted ranges are policy, not evidence: the exact builds and versions resolved here are
// recorded in `active.json`, diagnostics and every backup / switch manifest.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import type { DatabaseEngine } from '../box-json.js'

/** The server major every supported engine speaks (pgrust reports PostgreSQL 18 compatibility). */
export const SERVER_MAJOR = 18
/** Oldest pgvector accepted on native. An open-ended policy, not a claim that later releases are qualified. */
export const MIN_PGVECTOR = '0.8.0'

/** pgrust builds this Box accepts, with the publisher's checksums (pgrust.com/downloads/<tag>/MANIFEST.txt). */
const PGRUST_RELEASES = {
  '0.4-beta': {
    build: '20911cc',
    files: {
      'darwin-arm64': { name: 'pgrust-0.4-beta-macos-arm64.tar.gz', sha256: '882bb8db37bd7053821d72d75084b9a98b3383117beb7ddc13cff6725c9431f2' },
      'darwin-x64': { name: 'pgrust-0.4-beta-macos-x86_64.tar.gz', sha256: 'f7751e89525637c196788167cb94a47b80350a993845e2955f22061b795869ab' },
      'linux-x64': { name: 'pgrust-0.4-beta-linux-x86_64.tar.gz', sha256: '9a53fdc039ca338808702641369b0ac7d6c163124f76f2bfd21860b0be9fb7bb' },
      'linux-arm64': { name: 'pgrust-0.4-beta-linux-aarch64.tar.gz', sha256: 'ba5e9358f05c30aaab704e915b88b7890ace629134d9c52b6910311d71a26c94' },
    },
  },
} as const
export type PgrustTag = keyof typeof PGRUST_RELEASES
export const PGRUST_TAG: PgrustTag = '0.4-beta'

type HostPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64'

export function hostPlatform(): HostPlatform | null {
  const p = `${platform()}-${arch()}`
  return p === 'darwin-arm64' || p === 'darwin-x64' || p === 'linux-x64' || p === 'linux-arm64' ? p : null
}

/** A resolved engine installation: everything the lifecycle needs to run and describe it. */
export interface EngineInstall {
  engine: DatabaseEngine
  binDir: string
  /** Server version, e.g. `18.6`. */
  version: string
  major: number
  /** The exact build, as the server reports it (`postgres --version`). */
  build: string
  pgvector: string
  /** Settings every server start of this engine carries. */
  serverArgs: string[]
  /** Environment for the server child only. */
  env: Record<string, string>
  /** Shell prefix for the server child (pgrust needs a large stack). */
  shellPrefix: string
}

export interface ClientTools {
  binDir: string
  version: string
  major: number
}

/** Thrown when an engine or the client tools are missing or out of range; `hint` is the install command. */
export class EngineUnavailable extends Error {
  constructor(message: string, readonly hint: string) { super(`${message}\n${hint}`) }
}

function run(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim()
}

/** `postgres (PostgreSQL) 18.6` -> `18.6`; `PostgreSQL 18.6 (pgrust ...)` too. */
export function parseServerVersion(text: string): string | null {
  return /PostgreSQL\)?\s+(\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null
}

/** Compare dotted versions numerically (`0.8.10` > `0.8.7`); pre-release tails are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

function controlVersion(controlFile: string): string | null {
  if (!existsSync(controlFile)) return null
  return /default_version\s*=\s*'([^']+)'/.exec(readFileSync(controlFile, 'utf8'))?.[1] ?? null
}

// ---- Install hints (what `box setup` offers and refusals name) ----

export function nativeInstallHint(): string {
  if (platform() === 'darwin') return `Install it with Homebrew: brew install postgresql@${SERVER_MAJOR} pgvector`
  return `Install it with the PostgreSQL apt repository (https://www.postgresql.org/download/linux/): sudo apt install postgresql-${SERVER_MAJOR} postgresql-${SERVER_MAJOR}-pgvector`
}

export function clientToolsHint(): string {
  if (platform() === 'darwin') return `Install the client tools with Homebrew: brew install libpq (or postgresql@${SERVER_MAJOR})`
  return `Install the client tools: sudo apt install postgresql-client-${SERVER_MAJOR} (PostgreSQL apt repository)`
}

/** Whether `cmd` is on PATH. */
function onPath(cmd: string): boolean {
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore', timeout: 5_000 }); return true } catch { return false }
}

/**
 * The host command `box setup` offers to run (on the owner's confirmation) for what is missing:
 * native PostgreSQL with pgvector (which brings the client tools too), or the client tools alone.
 * Null when this host has no supported package manager; the refusal's hint then names the steps.
 */
export function hostInstallCommand(what: 'native' | 'client-tools', has: (cmd: string) => boolean = onPath): string[] | null {
  if (platform() === 'darwin') {
    if (!has('brew')) return null
    return what === 'native' ? ['brew', 'install', `postgresql@${SERVER_MAJOR}`, 'pgvector'] : ['brew', 'install', 'libpq']
  }
  if (platform() === 'linux' && has('apt-get')) {
    return what === 'native'
      ? ['sudo', 'apt-get', 'install', '-y', `postgresql-${SERVER_MAJOR}`, `postgresql-${SERVER_MAJOR}-pgvector`]
      : ['sudo', 'apt-get', 'install', '-y', `postgresql-client-${SERVER_MAJOR}`]
  }
  return null
}

// ---- Native PostgreSQL: one installation, resolved deliberately ----

function nativeCandidates(): string[] {
  const dirs = [
    `/opt/homebrew/opt/postgresql@${SERVER_MAJOR}/bin`,
    `/usr/local/opt/postgresql@${SERVER_MAJOR}/bin`,
    `/usr/lib/postgresql/${SERVER_MAJOR}/bin`,
    `/usr/pgsql-${SERVER_MAJOR}/bin`,
  ]
  // Last resort: the pg_config on PATH, whose own --bindir names its installation.
  try { dirs.push(run('pg_config', ['--bindir'])) } catch { /* not on PATH */ }
  return [...new Set(dirs)]
}

/** Check one candidate bin dir as a complete installation; returns the reason it does not qualify. */
export function inspectNative(binDir: string): EngineInstall | string {
  const postgres = join(binDir, 'postgres'), pgConfig = join(binDir, 'pg_config')
  if (!existsSync(postgres)) return `${binDir}: no postgres server binary`
  if (!existsSync(pgConfig)) return `${binDir}: no pg_config beside the server (an incomplete installation)`
  let build: string, configVersion: string, sharedir: string, pkglibdir: string
  try {
    build = run(postgres, ['--version'])
    configVersion = run(pgConfig, ['--version'])
    sharedir = run(pgConfig, ['--sharedir'])
    pkglibdir = run(pgConfig, ['--pkglibdir'])
  } catch (e) { return `${binDir}: could not run the server or pg_config (${(e as Error).message.split('\n')[0]})` }
  const version = parseServerVersion(build)
  if (!version) return `${binDir}: unrecognised server version "${build}"`
  if (parseServerVersion(configVersion) !== version) return `${binDir}: pg_config reports ${configVersion}, the server ${build}: not one installation`
  const major = Number.parseInt(version, 10)
  if (major !== SERVER_MAJOR) return `${binDir}: PostgreSQL ${version}, this Box needs ${SERVER_MAJOR}.x`
  const pgvector = controlVersion(join(sharedir, 'extension', 'vector.control'))
  if (!pgvector) return `${binDir}: pgvector is not installed for this PostgreSQL`
  if (compareVersions(pgvector, MIN_PGVECTOR) < 0) return `${binDir}: pgvector ${pgvector}, this Box needs ${MIN_PGVECTOR} or later`
  if (!['vector.so', 'vector.dylib'].some((f) => existsSync(join(pkglibdir, f)))) return `${binDir}: pgvector's library is missing from ${pkglibdir}`
  return { engine: 'native', binDir, version, major, build, pgvector, serverArgs: [], env: {}, shellPrefix: '' }
}

export function resolveNative(): EngineInstall {
  const reasons: string[] = []
  for (const dir of nativeCandidates()) {
    const r = inspectNative(dir)
    if (typeof r !== 'string') return r
    if (existsSync(dir)) reasons.push(r)
  }
  throw new EngineUnavailable(
    `Native PostgreSQL ${SERVER_MAJOR} with pgvector was not found on this host${reasons.length ? `:\n  ${reasons.join('\n  ')}` : '.'}`,
    nativeInstallHint(),
  )
}

// ---- Client tools: pg_dump / pg_restore at least as new as the servers they serve ----

function toolCandidates(): string[] {
  const dirs = [
    ...nativeCandidates(),
    '/opt/homebrew/opt/libpq/bin',
    '/usr/local/opt/libpq/bin',
  ]
  return [...new Set(dirs)]
}

export function resolveClientTools(minMajor = SERVER_MAJOR): ClientTools {
  const reasons: string[] = []
  for (const dir of toolCandidates()) {
    const dump = join(dir, 'pg_dump'), restore = join(dir, 'pg_restore')
    if (!existsSync(dump) || !existsSync(restore)) continue
    try {
      const dv = parseServerVersion(run(dump, ['--version'])), rv = parseServerVersion(run(restore, ['--version']))
      if (!dv || dv !== rv) { reasons.push(`${dir}: pg_dump ${dv} and pg_restore ${rv} differ`); continue }
      const major = Number.parseInt(dv, 10)
      if (major < minMajor) { reasons.push(`${dir}: client tools ${dv}, need ${minMajor} or later`); continue }
      return { binDir: dir, version: dv, major }
    } catch (e) { reasons.push(`${dir}: ${(e as Error).message.split('\n')[0]}`) }
  }
  throw new EngineUnavailable(
    `pg_dump and pg_restore ${minMajor} or later were not found on this host${reasons.length ? `:\n  ${reasons.join('\n  ')}` : '.'}`,
    clientToolsHint(),
  )
}

// ---- pgrust: the publisher's tarball, verified and unpacked under data/engines ----

const PGRUST_SETTINGS = [
  '-c', 'io_method=sync', '-c', 'max_stack_depth=60000',
  // Its own memory watchdog: cancels the statement holding the most memory near the limit
  // (observed on Linux; it does not cancel on macOS). No OS cap is applied (Toby, 2026-11-06).
  '-c', 'pgrust.memory_watchdog=on', '-c', 'pgrust.memory_watchdog_limit=2GB',
  '-c', 'pgrust.memory_cancel_threshold=90', '-c', 'pgrust.memory_governor_threshold=95',
]

export function pgrustDir(enginesDir: string, tag: PgrustTag = PGRUST_TAG): string {
  return join(enginesDir, `pgrust-${tag}`)
}

/** Inspect an unpacked pgrust; `cacheDir` keeps its machine cost profile inside the cluster. */
export function inspectPgrust(dir: string, cacheDir: string): EngineInstall | string {
  const postgres = join(dir, 'bin', 'postgres')
  if (!existsSync(postgres)) return `${dir}: not unpacked`
  let build: string
  try { build = run(postgres, ['--version']) } catch (e) { return `${dir}: could not run pgrust (${(e as Error).message.split('\n')[0]})` }
  const version = parseServerVersion(build)
  if (!version || Number.parseInt(version, 10) !== SERVER_MAJOR) return `${dir}: unexpected version "${build}"`
  const pgvector = controlVersion(join(dir, 'bin', 'share', 'extension', 'vector.control'))
    ?? controlVersion(join(dir, 'share', 'extension', 'vector.control'))
  if (!pgvector) return `${dir}: bundled pgvector not found`
  return {
    engine: 'pgrust', binDir: join(dir, 'bin'), version, major: SERVER_MAJOR, build, pgvector,
    serverArgs: [...PGRUST_SETTINGS],
    env: { RUST_MIN_STACK: '33554432', PGRUST_COST_CACHE_DIR: cacheDir, XDG_CACHE_HOME: cacheDir },
    shellPrefix: 'ulimit -s 65520; ',
  }
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/**
 * Make sure the pinned pgrust build is unpacked under `enginesDir`, fetching and verifying the
 * publisher's tarball when it is missing. The checksum is checked before anything is unpacked.
 */
export async function ensurePgrust(enginesDir: string, cacheDir: string, tag: PgrustTag = PGRUST_TAG): Promise<EngineInstall> {
  const dir = pgrustDir(enginesDir, tag)
  const ready = inspectPgrust(dir, cacheDir)
  if (typeof ready !== 'string') return ready
  const host = hostPlatform()
  if (!host) throw new EngineUnavailable(`pgrust has no build for ${platform()}-${arch()}.`, 'Set "database": { "engine": "native" } in box.json and install PostgreSQL.')
  const file = PGRUST_RELEASES[tag].files[host]
  mkdirSync(enginesDir, { recursive: true, mode: 0o700 })
  const staging = join(enginesDir, `.staging-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { mode: 0o700 })
  try {
    const tarball = join(staging, file.name)
    const res = await fetch(`https://pgrust.com/downloads/v${tag}/${file.name}`)
    if (!res.ok) throw new EngineUnavailable(`Downloading pgrust ${tag} failed: HTTP ${res.status}.`, 'Check the network and retry.')
    writeFileSync(tarball, new Uint8Array(await res.arrayBuffer()))
    const got = await sha256File(tarball)
    if (got !== file.sha256) throw new EngineUnavailable(`pgrust ${tag} download checksum mismatch (got ${got}).`, 'Retry; if it persists the download is not the published build.')
    const out = join(staging, 'out')
    mkdirSync(out)
    run('tar', ['xzf', tarball, '-C', out, '--strip-components=1'])
    rmSync(dir, { recursive: true, force: true })
    renameSync(out, dir)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const r = inspectPgrust(dir, cacheDir)
  if (typeof r === 'string') throw new EngineUnavailable(`pgrust ${tag} unpacked but does not run: ${r}`, 'Delete data/engines and retry.')
  return r
}
