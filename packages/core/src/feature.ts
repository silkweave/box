// The core feature contract. Features live in features/<id>/core/.
// Register their entry modules in src/generated/features.ts, maintained alongside the source.
// See docs/core/SEAM.md for the runtime contracts and dependency direction.

import type { ModelSpec } from './warehouse/model.js'
import type { Migration } from './warehouse/schema.js'
import type { ActionSpec } from './ops/types.js'

export interface CoreFeature {
  /** The directory name. A lowercase slug. It is the migration ledger namespace: NEVER renamed. */
  id: string
  /** Features whose tables and migrations must exist before this one boots. Must cover every
   *  `../<feature>/` import in this directory. */
  dependsOn?: readonly string[]
  /** Tables this feature OWNS. Baselined with CREATE TABLE IF NOT EXISTS on every boot. */
  models: readonly ModelSpec[]
  /** Tables this feature once owned and its own migrations dropped or reshaped (a renamed
   *  feature's old tables, a model it retired). Never baselined; they count as its own only for
   *  the migration ownership check, so dropping them is not mistaken for a cross-feature read. */
  retiredTables?: readonly string[]
  /** Idempotent DDL re-run on every boot AFTER every CREATE TABLE (views, indexes). */
  baseline?: readonly string[]
  /** Append-only, one ledger row each, keyed `${id}:${name}`. Starts empty in the template. */
  migrations: readonly Migration[]
  /** Runnable ops contributed to core's run funnel (scheduler, Run now, MCP, CLI). */
  actions?: readonly ActionSpec[]
  /** The boards this feature draws with a preset bar, by preset module id (`config/presets.json`).
   *  Only registered ids are accepted, so a typo cannot create a module nothing renders. */
  presetModules?: readonly string[]
  /** Background capabilities this feature arms from box.json `background.features.<id>.<key>`
   *  (each false unless set), by key, with what each arms. Read only through `isBackgroundEnabled`
   *  (background.ts); a configured key a registered feature does not declare fails the boot. */
  background?: Readonly<Record<string, string>>
}

/** `const` type parameter: the manifest keeps its literal types (tuple of ModelSpecs, literal id). */
export function defineCoreFeature<const T extends CoreFeature>(feature: T): T {
  return feature
}
