#!/usr/bin/env node
// Write this Box's `box.json` from core's defaults when the checkout has none. Runs first in
// the root `prepare`, so the file exists before `pnpm build` (the SPA bakes the brand in) and is
// there to edit before the first boot - the ports, the brand, and the system principal, which is
// meant to be chosen BEFORE the warehouse exists.
//
// Writes shared defaults on fresh checkouts. Existing stores require an explicit identity.
// Usage: pnpm box:json
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeBoxJsonIfAbsent } from '@silkweave/box-core/box-json'
import { isMain, repoRoot } from './repo.ts'

export type BoxJsonInit = 'written' | 'present' | 'deferred'

export function initBoxJson(root: string = repoRoot): { outcome: BoxJsonInit; file: string; why: string } {
  const file = join(root, 'box.json')
  if (existsSync(file)) return { outcome: 'present', file, why: 'already there' }
  if (existsSync(join(root, 'data', 'data.db'))) {
    return { outcome: 'deferred', file, why: 'existing data/data.db requires explicit configuration' }
  }
  writeBoxJsonIfAbsent(file)
  return { outcome: 'written', file, why: 'fresh checkout' }
}

if (isMain(import.meta.url)) {
  const { outcome, why } = initBoxJson()
  if (outcome === 'written') console.log('box:json: wrote box.json with the defaults - edit the agent, brand and ports there before the first boot')
  else if (outcome === 'deferred') console.log(`box:json: not writing box.json - ${why}`)
}
