# Validation record

## Bun migration complete, 2026-09-19

The core-only Box now uses Bun 1.4.2 for package installation and runtime execution. The final
`box verify --plain` passed all nine checks: build, skills, 31 CLI tests, type generation,
typecheck, lint, 120 core/feature tests, 32 server tests, and schema checks covering
1 feature, 4 tables, fresh and repeated boot. Existing chunk-size and DTO reflection warnings remain. Box lint also reports its empty core export surface and unused box-config imports.

Fresh source-only snapshots outside `box/` installed with `bun install --frozen-lockfile`
and passed the full chain with no old pnpm node_modules present. The Stack native dependency
install initially hit sandbox EPERM; repeating the approved install outside the sandbox succeeded.
The two new CLI cases cover checkout-aware command forwarding, exit status, Bun execution and
shim installation without overwriting foreign programs. The CLI warning detector now recognizes
Bun's passing-test prefix. A separate Vitest worker probe confirmed Bun 1.4.2, and a scratch
.env sentinel confirmed automatic dotenv loading remains disabled.

Both independent checkouts booted via `box start --prod` and `box dev`, with their own data,
ports 18793/18794 and 18795/18796, background work disabled and WorkerDeck off. Chrome DevTools
verified short-lived-link sign-in and settings. Dev testing found icon placeholders rewritten
as protocol-relative URLs; moving branding substitution before Vite's HTML processing fixed
both checkouts, with correct icon URLs and no browser console errors after restart.

A real Stack pseudo-terminal verification passed with 282 clean frames, detail toggling,
two resizes, a colored final receipt and restored cursor/screen. After a stop test exposed
orphaned Turbo descendants, the launcher and Bun run configuration gained no-orphans handling.
Repeating the dev stop checks released all four ports. All temporary servers were stopped.
The final full verification above includes the branding and launcher fixes.

Artifacts: `/tmp/silkweave-bun-migration-20260919/box-final-verify-3.log` plus the clean-install,
browser-server and terminal logs in that directory. Gatekeeper audit completed without findings;
these workspaces have no publishable packages. No migrations, configured identities, credentials
or live instance data were changed. WorkerDeck upstream fixes are assumed forthcoming, not
claimed as installed; authenticated engine turns remain outside this migration's tested scope.
See [BUN.md](BUN.md) and [WORKERDECK-BUN.md](WORKERDECK-BUN.md).

Wrapup verification, 2026-09-19: `box verify --plain` passed again on Bun 1.4.2 with
the same test and schema counts. Existing warnings remain. The transcript is
`/tmp/silkweave-bun-wrapup/box-verify.log`. Gatekeeper audit is clean; Roam advisory
tooling is unavailable. Prior dev/production browser and terminal smoke results above
apply to the unchanged runtime source. Earlier temporary migration logs have been cleaned
up; the current wrapup transcript is retained at the path above.

## Historical Node/pnpm baseline

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
