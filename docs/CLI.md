# Command-line tooling

`box verify` runs the checkout's complete validation chain with a four-phase progress view:

| Phase | Checks, in order |
|---|---|
| Build | Workspace build |
| Prepare | Skill linking, CLI tests, generated types |
| Check | Typecheck, lint |
| Validate | Core tests, server tests, schema matrix |

The active phase expands into checks; completed phases collapse. The progress bar counts completed
checks, not estimated elapsed time. The activity line comes from the real child process. A check
that goes quiet keeps its spinner and elapsed time, with a notice after eight seconds without output.
Periwinkle text animation is always enabled when supported by the terminal.

Press `d` to show or hide recent command output. Detail uses the space available in the terminal;
enlarge a short window to see more lines. Ctrl+C stops the current command and its descendants,
escalating to forced termination after 1.5 seconds if needed. The remaining checks do not run.
Success and cancellation restore the normal screen and cursor and leave a phase summary in
scrollback, styled with the same status colors and aligned phase timings. Warning excerpts omit
transport prefixes and clip to the terminal width; the full warning text remains in the logs.
Failures also show diagnostics, recent output, the failed command and a rerun hint.

```sh
box verify
box verify --plain
box verify --verbose
```

`--plain` writes append-only progress without terminal controls. `--verbose` also streams all child
output, with check names as prefixes. CI, redirected output and dumb terminals automatically use
append-only progress. `NO_COLOR` removes colors; the live progress view still updates. Terminal
capabilities control color depth. These are terminal conventions, not Box configuration settings.

Every run creates a private `silkweave-verify-*` directory in the operating system's temporary
directory, with one log per started check. The final summary prints its absolute path. Logs retain
the complete stdout/stderr output in arrival order, including original color codes; the live view
strips terminal controls and bounds its recent-output buffer. Temporary logs last until deleted
or cleaned by the operating system. No logs or settings are written into the Box's instance data.

Warning-looking output remains visible in the summary even when a command succeeds. This is a
text heuristic, not a parsed warning count. A nonzero exit stops the chain and is returned to the
caller; startup failures return 1, cancellation returns 130, and invalid options return 2.

The renderer, task engine and verify command live in `packages/cli/src/`. `ui.ts` supplies terminal
styling, text clipping and safe redraw; `tasks.ts` owns ordered child execution and logs;
`task-view.ts` supplies the verify layout; `verify.ts` connects terminal controls to the nine checks.
They use Node-compatible built-ins under Bun, with no React, Ink or additional dependencies.
Verification executes explicit `bun run` commands using the current Bun executable. It does not
inherit a package-manager executable from npm or pnpm. Each check runs in the selected checkout.

The `box` shim exposes `dev`, `build`, `start`, `start --prod`, and `verify`, alongside auth,
database operations, target selection and MCP tools. These explicit verbs take precedence over
MCP tool names. `box verify` preserves flags and exit status from the selected checkout's runner.
Use `bun run verify` or `packages/cli/bin/box verify` before installing the shim.

The broader browser Build workspace remains a proposal; see [BUILD-EXPLORATION.md](BUILD-EXPLORATION.md).
See [BUN.md](BUN.md) for the runtime migration. Subprocess cancellation and live rendering are
exercised on macOS/POSIX. Windows uses `taskkill`; Windows behavior has not been field-tested.
