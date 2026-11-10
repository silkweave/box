// Test clusters. A database isolates tables, not cluster-wide roles: tests that create logins,
// groups or memberships get their own cluster from here (PHASE1.md choice 11). Engines are
// cached outside any Box (`<tmp>/box-test-engines`), so a test run never writes a Box's data/.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseEngine } from '../box-json.js'
import { clusterOf, initCluster, openCluster, ownerClient, type RunningCluster } from './cluster.js'
import { ensurePgrust, resolveNative, type EngineInstall } from './engines.js'

export function testEnginesDir(): string {
  const dir = join(tmpdir(), 'box-test-engines')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export async function testEngine(engine: DatabaseEngine, cacheDir: string): Promise<EngineInstall> {
  return engine === 'pgrust' ? ensurePgrust(testEnginesDir(), cacheDir) : resolveNative()
}

/** Whether an engine can run here; native needs the host installation. */
export function engineAvailable(engine: DatabaseEngine): boolean {
  if (engine === 'pgrust') return true
  try { resolveNative(); return true } catch { return false }
}

export interface TestCluster {
  running: RunningCluster
  install: EngineInstall
  /** Run owner (maintenance) SQL against a database. */
  owner(sql: string, database?: string): Promise<void>
  stop(): Promise<void>
}

/** A private, throwaway cluster for one test file. */
export async function startTestCluster(engine: DatabaseEngine): Promise<TestCluster> {
  const dir = mkdtempSync(join(tmpdir(), `box-test-db-${engine}-`))
  const c = clusterOf(dir, `${engine}-1`)
  const install = await testEngine(engine, join(c.dir, 'cache'))
  await initCluster(c, install)
  // One test cluster serves every parallel Vitest worker, and each worker's executor holds its own
  // connection budget; the production limit (40, one Box process) is too tight for that sum.
  const running = await openCluster(c, install, 'test', { settings: ['-c', 'max_connections=160'] })
  return {
    running, install,
    async owner(sql, database = 'postgres') {
      const o = ownerClient(running, database)
      await o.connect()
      try { await o.query(sql) } finally { await o.end() }
    },
    async stop() {
      try { await running.release() } finally { rmSync(dir, { recursive: true, force: true }) }
    },
  }
}
