// Which core and server tests a run includes. The Stack runs them all. `box verify` in a Box whose
// core and server sources match its upstream sets BOX_TEST_SCOPE=box (packages/cli/src/verify.ts):
// that core was verified in the Stack before release, so the Box runs its features' tests plus a
// small core smoke set. Every run still migrates a template database with all registered features
// (vitest.db-setup.ts), and schema:check, build and typecheck cover the rest. BOX_TEST_SCOPE is a
// switch between verify and this harness only, never a Box setting; turbo.json hashes it.

export const boxScope = process.env.BOX_TEST_SCOPE === 'box'

/** Core tests a Box always runs: configuration, sign-in, roles and the warehouse schema. */
export const CORE_SMOKE = [
  'src/box-json.test.ts',
  'src/auth/session.test.ts',
  'src/auth/roles.test.ts',
  'src/warehouse/schema.test.ts',
]

/** Server tests a Box always runs: the auth guard every request passes. */
export const SERVER_SMOKE = [
  'src/auth/auth.guard.test.ts',
]
