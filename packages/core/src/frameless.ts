// The scope of code with no context frame at all (request-context.ts). Production never sets it:
// no frame is `none`. The test setup sets system work through `@silkweave/box-core/testing`, so
// test bodies can call core functions directly. Process-global like the context store, because the
// module can load twice in tests (source and build paths). Kept import-free so the test setup can
// set it without loading the feature registry before a test file mocks it.

export type FramelessScope = { kind: 'system'; reason: string } | { kind: 'none' }

const KEY = Symbol.for('silkweave.box.frameless-scope')
const globals = globalThis as Record<symbol, unknown>

export function setFramelessScopeForTests(scope: FramelessScope): void {
  globals[KEY] = scope
}

export function framelessScope(): FramelessScope {
  return (globals[KEY] as FramelessScope | undefined) ?? { kind: 'none' }
}
