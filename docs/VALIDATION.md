# Validation record

Validated 2026-09-19 in the fresh core-only consumer checkout with Node 24+ and pnpm 11.8.0.

| check | result |
|---|---|
| `pnpm install` | passed; workspace prepared and generated core-only registrations |
| `pnpm verify` | passed: build, CLI tests, type generation, typecheck, lint, core tests, server tests and schema check |
| CLI tests | 19 passed |
| Core tests | 120 passed in 13 files |
| Server tests | 32 passed in 3 files |
| Schema check | passed: core only, 4 tables, fresh and reboot paths |

The verifier emitted existing reflection and empty-registration lint warnings. They did not fail the
chain. Chrome DevTools MCP confirmed production sign-in and the core-only Settings/Users UI, with no console errors. The local server port override was exercised. Background work remained disabled. The runtime emitted an EMFILE watcher warning, so external file-change notifications remain unverified.
