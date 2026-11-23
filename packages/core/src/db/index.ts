// Bringing the Box's database up for a process: resolve pgrust, initialize a fresh Box's first
// cluster, then open it under the ownership rules in cluster.ts. The supervisor, the server and CLI
// scripts all come through here.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBoxConfig } from '../box-config.js'
import { dataPath } from '../io.js'
import {
  assertNoMaintenance, clusterOf, clusterPaths, initCluster, nextClusterName, openCluster, readActive, writeActive,
  type ActiveCluster, type OwnerRole, type RunningCluster,
} from './cluster.js'
import { recoverMaintenance } from './restore.js'
import { ensurePgrust, inspectPgrust, pgrustDir, type EngineInstall } from './engines.js'

export * from './cluster.js'
export * from './engines.js'

export function dbRoot(): string { return dataPath('db') }
export function enginesDir(): string { return dataPath('engines') }

/** Resolve the pgrust binaries; they are fetched into data/engines when missing. */
export async function resolveEngine(cacheDir: string): Promise<EngineInstall> {
  return ensurePgrust(enginesDir(), cacheDir)
}

/** Like resolveEngine, without downloading: for diagnostics. */
export function inspectEngine(cacheDir: string): EngineInstall | string {
  return inspectPgrust(pgrustDir(enginesDir()), cacheDir)
}

/** A fresh Box's first cluster, created once even when the server and a CLI script start together. */
async function initFirstCluster(root: string): Promise<ActiveCluster> {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const lock = join(root, 'init.lock')
  const deadline = Date.now() + 120_000
  for (;;) {
    try { closeSync(openSync(lock, 'wx', 0o600)); writeFileSync(lock, String(process.pid)); break }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const holder = Number(readFileSync(lock, 'utf8')) || 0
      let alive = false
      try { process.kill(holder, 0); alive = true } catch { /* dead */ }
      if (!alive) { rmSync(lock, { force: true }); continue }
      if (Date.now() > deadline) throw new Error(`another process (pid ${holder}) is still initializing the database`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  try {
    const existing = readActive(root)
    if (existing) return existing
    const name = nextClusterName(root)
    const c = clusterOf(root, name)
    const install = await resolveEngine(clusterPaths(c).cache)
    await initCluster(c, install)
    const active: ActiveCluster = { cluster: name, build: install.build, version: install.version, pgvector: install.pgvector, activated: new Date().toISOString() }
    writeActive(root, active)
    return active
  } finally { rmSync(lock, { force: true }) }
}

export interface OpenDatabase {
  running: RunningCluster
  active: ActiveCluster
  install: EngineInstall
}

/**
 * Open the Box's database for this process. A fresh Box (no `active.json`) initializes its first
 * cluster.
 */
export async function openDatabase(role: OwnerRole): Promise<OpenDatabase> {
  const root = dbRoot()
  // An interrupted restore is settled before anything else reads the active record.
  const recovery = await recoverMaintenance(root)
  if (recovery.summary) console.warn(`[database] ${recovery.summary}`)
  assertNoMaintenance(root)
  let active = readActive(root)
  // A fresh Box writes its configuration (and binds the agent identity) before its first cluster
  // exists: from then on a database without box.json is an existing Box that lost it.
  if (!active) {
    ensureBoxConfig()
    active = await initFirstCluster(root)
  }
  const c = clusterOf(root, active.cluster)
  const install = await resolveEngine(clusterPaths(c).cache)
  const running = await openCluster(c, install, role)
  return { running, active, install }
}
