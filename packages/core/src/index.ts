// @silkweave/box-core - the shared library. Core (io, auth, users, events, ops, warehouse) plus
// every present feature's barrel, via the generated re-export below. Source-first (consumers
// resolve .ts through the box-source condition). See docs/core/SEAM.md.

// io.js by name, not `*`: setInstanceDir/resetInstanceDir are test seams, published only through
// `@silkweave/box-core/testing` (src/testing.ts says why they stay off this surface).
export { configRoot, configPath, dataPath, docsDir, instanceDir, instanceRelative, repoRoot, warehousePath } from './io.js'
export * from './box-config.js'
export {
  BOX_BRAND_KEYS,
  BOX_JSON_SCHEMA_REF,
  defaultBoxJson,
  parseBoxJson,
  readBoxJsonFile,
  readBoxConfig,
  writeBoxLocal,
  type BoxAgent,
  type BoxBackground,
  type BoxBackup,
  type BoxJson,
  type BoxServer,
  type BoxStack,
  stackSourceKind,
} from './box-json.js'
export * from './stack-source.js'
export * from './changes.js'
export * from './http.js'
export * from './accounts.js'
export * from './credentials.js'
export * from './events.js'
export * from './agent-session.js'
// Every PRESENT feature's public barrel, through the generated file - never a hand-written list.
// A hand list makes `rm -rf` of a feature's directory break this module, which is exactly the
// invariant the seam exists to hold (SEAM 6.1: no file outside the three directories is touched).
export * from './generated/exports.js'
export * from './feature.js'
export * from './ops/types.js'
export * from './ops/run.js'
export * from './ops/runs.js'
export * from './ops/run-log.js'
export * from './ops/registry.js'
export * from './warehouse/db.js'
export * from './warehouse/backup.js'
export * from './warehouse/core-models.js'
export * from './warehouse/schema.js'
export * from './users/types.js'
export * from './users/state.js'
export * from './users/cleanup.js'
export * from './path-mounts.js'
export * from './auth/token.js'
export * from './auth/session.js'
export * from './auth/link.js'
export * from './auth/security.js'
export * from './auth/principal.js'
export * from './auth/bootstrap.js'
export * from './auth/secrets.js'
export * from './agent-profiles.js'

export { boxBrand, type BoxBrand } from './brand.js'
