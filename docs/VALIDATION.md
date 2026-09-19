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

## Implemented verify runner, 2026-09-19

The final `pnpm verify` run through the new CLI runner passed all nine checks: build, skills,
29 CLI tests, generated types, typecheck, lint, 120 core tests, 32 server tests and schema check
(core only, 4 tables, fresh/repeated boot). Source is the CLI working snapshot recorded in
UPSTREAM.md, not a new completed core revision. The consumer's pnpm 11.8.0 uses a standalone
executable; support for that executable was added after the first run failed at Build. Its
subprocess runtime reported Node 26.0.0, including the existing module.register deprecation.

Existing build-size, reflection, core-only unused-import lint and module.register deprecation
warnings remain. They are retained in logs and the summary; they do not fail this chain.
The 10 new CLI tests cover execution, native/script pnpm resolution, fail-fast behavior,
log retention, warning classification, plain/verbose modes, cancellation, and terminal redraw.
Matching Stack CLI source also passed a real interactive run with detail toggling, resizing
and restored cursor/screen, plus a separate Ctrl+C keyboard fixture. Windows behavior is not
field-tested. No application routes, runtime registrations or migrations changed, so the earlier
browser smoke record above was not repeated or expanded by this CLI-only integration.

Run transcript: `/tmp/silkweave-cli-integration-20260919/box-verify-final.log`.
Complete command logs: `/var/folders/00/8hfks6z576g1l1wrr7wh2wk80000gn/T/silkweave-verify-7cDkbL`.

## Styled final receipt, 2026-09-19

The complete `pnpm verify` chain passed after the receipt-formatting refinement, including
29 CLI tests. Receipt assertions cover ANSI/plain parity, no cursor movement, compact warning
excerpts and intact log paths. The CLI typecheck and focused lint passed. The real Stack terminal
run passed all nine checks in 38.0 seconds, with 471 clean redraws, detail toggling, resizing and
cursor/screen restoration. Its final receipt contains truecolor styling; the consumer append-only
transcript contains no ANSI. Existing warnings remain, and complete warning text stays in logs.
No application routes or runtime registrations changed.

Artifacts: `/tmp/silkweave-cli-integration-20260919/receipt-terminal-receipt.log` and
`/tmp/silkweave-cli-integration-20260919/box-receipt-verify.log`.

CLI wrapup, 2026-09-19: the final source retains the passing full-chain results above. Gatekeeper
completed with no findings; all workspace packages are private, so no publishable tarballs were
in scope. No application routes changed. The unrelated pre-existing .codex/config.toml deletion
is outside the CLI commit. Roam advisory tooling was not available.
