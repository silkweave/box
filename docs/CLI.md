# Command-line tooling

The public CLI uses the `box` shim at `packages/cli/bin/box`. Register it once with
`bun --no-env-file packages/cli/src/box-install.ts`; use `--check` to inspect its registration without changing it.
The installer links it into `~/.local/bin` and reports whether that directory is on PATH.
`box where` explains which checkout it targets. Auth, database and MCP commands run through
the selected checkout's CLI; no `bun run` or package-script prefix is needed for these verbs.

## First-run setup

`bun setup` is the guided host-only path immediately after `bun install`; `box setup` is the same
command once the shim is registered. It confirms the machine principal, asks for the first owner,
detects `CODEX_HOME`/`~/.codex` and `CLAUDE_CONFIG_DIR`/`~/.claude`, and offers each detected profile
for configuration. It never reads or prints provider credentials. Marker files are used only to
warn when provider sign-in may still be required.

Setup creates the first administrator only when no human exists, stores the new access token in
mode-0600 `box.local.json` for the local MCP proxy, and issues a single-use sign-in link. In an
interactive terminal it then runs `box dev` and opens that link in the browser as soon as the
application and frontend are running; quitting the dev view ends setup. Re-running against a
populated Box refuses without rotating anything. For automation and tests, use `--owner`,
`--name`, `--profiles codex,claude`, `--no-profiles`, `--no-start` and `--yes` (which never starts
the Box).

`box verify` runs the checkout's complete validation chain with a four-phase progress view:

| Phase | Checks, in order |
|---|---|
| Build | Workspace build |
| Prepare | Skill linking, CLI tests, web tests, generated types |
| Check | Typecheck, lint |
| Validate | Core tests, server tests, schema matrix, mobile app |

Every check except the mobile app needs the workspace build, and the typecheck also needs generated
types. Otherwise a failure does not stop the chain: independent checks still run, the receipt lists every failed check
with its diagnostics, and checks whose prerequisites failed are reported as not run. The exit status
is the first failed check's.

The mobile app check (`bun run test:mobile`, `packages/cli/src/mobile-check.ts`) runs `flutter pub
get`, `flutter analyze` and, where a `test/` directory exists, `flutter test` for the framework
(`packages/mobile`), each feature module (`features/<id>/mobile`) and the app (`apps/mobile`).
Without `flutter` on PATH it prints a skip and passes, so a Box without the Flutter SDK still
verifies; install Flutter to make the mobile app part of the verified chain. See [MOBILE.md](MOBILE.md).

The build, typecheck, core tests and server tests go through Turbo's content-hash cache. A package's
tests rerun only when its sources, its test configuration, a workspace dependency's build (core for
the server) or a global input (`features/`, `recipes/`, `box.json`, `box.local.json`) changed;
otherwise Turbo replays the last passing output in milliseconds. `box verify --force` re-executes
them all. Run `bun run test:core` or `bun run test:server` for the same cached package tests alone.

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
box verify --json
box verify --list
box verify --verbose
```

`--plain` writes append-only progress without terminal controls. `--verbose` also streams all child
output, with check names as prefixes. CI, redirected output and dumb terminals automatically use
append-only progress. `NO_COLOR` removes colors; the live progress view still updates. Terminal
capabilities control color depth. These are terminal conventions, not Box configuration settings.

`--json` writes one progress snapshot per line (`{"verify":1,...}`) with every check's status,
elapsed time, counted test progress, warning excerpts and failure diagnostics, then the plain
summary. Builder Wrap Up uses it to draw its task list. Test progress comes from the runners' own
lines: Vitest runs with its default reporter so finished files report their test counts, and Bun
test reports its total at the end. Each passing run records check durations and test totals in
`node_modules/.cache/silkweave-verify.json`, so the next run can show `172/244 tests` and a
time-based estimate for checks that report no counts.
`--list` prints the checks as one JSON array without running them; Wrap Up uses it to show the
whole table, queued, before a first run's opening snapshot.

Every run creates a private `silkweave-verify-*` directory in the operating system's temporary
directory, with one log per started check. The final summary prints its absolute path. Logs retain
the complete stdout/stderr output in arrival order, including original color codes; the live view
strips terminal controls and bounds its recent-output buffer. Temporary logs last until deleted
or cleaned by the operating system. No logs or settings are written into the Box's instance data.

Warning-looking output remains visible in the summary even when a command succeeds. This is a
text heuristic, not a parsed warning count. The first failed check's nonzero exit is returned to
the caller; startup failures return 1, cancellation returns 130, and invalid options return 2.

The renderer, task engine and verify command live in `packages/cli/src/`. `ui.ts` supplies terminal
styling, text clipping and safe redraw; `tasks.ts` owns ordered child execution and logs;
`task-view.ts` supplies the verify layout; `verify.ts` connects terminal controls to the eleven checks.
They use Node-compatible built-ins under Bun, with no React, Ink or additional dependencies.
Verification executes explicit `bun run` commands using the current Bun executable. It does not
inherit a package-manager executable from npm or pnpm. Each check runs in the selected checkout.

The **box** shim exposes **dev**, **build**, **start**, **start --prod**, and **verify**, alongside auth,
database operations, target selection, Stack source commands and MCP tools. These explicit verbs take precedence over
MCP tool names. **box verify** preserves flags and exit status from the selected checkout's runner.

`box app status` reads the editable application's state from the owner-only local supervisor
socket, plus the run mode and the frontend's state: **dev** (`box dev`, every page is served by a
Vite dev server the supervisor owns, and the command probes it) or **built** (`box start`, everyone
loads the promoted web release; the command names the release, its source revision and when it was
built, and whether the Builder Preview's Vite is running). In built mode web changes reach other
users only through a promotion. `--json` prints the raw
`{ application, frontend }` document for agents. `box app restart` asks that already-running supervisor to restart only its editable
application child and waits for the normal health check. It preserves the supervisor, Vite and the
Builder WorkerDeck host, including the active Builder session. It does not run validation; run
`box verify` first when activating source changes.

`box app restart --frontend` restarts only the Vite dev server, the same operation as the `f` key in
the `box dev` view, and waits until Vite answers. Use it after a `box.json` brand edit or when Vite is
down or holds stale module state. The application, supervisor and Builder session keep running. In
built mode it restarts the Builder Preview's Vite, and is refused when no Builder session runs one.

`box app promote` asks the supervisor to typecheck, then build and publish a new web release, the
same operation as **Promote** in Builder. Open tabs outside Builder are offered a reload. It is
refused in `box dev`, where every page already comes from Vite.

`box maintenance` shows and changes maintenance mode through the same local socket (see
"Maintenance mode" in [SERVER.md](SERVER.md)). `on [--lock-admins] [--status <text>] [--eta <when>]
[--task <label>]...` starts it, `off` ends it and clears the notice, `note <text>` sets the status,
`eta <when>|none` the estimate (`20m`, `1h30m`, `14:30` or an ISO time), `tasks <label>...` replaces
the checklist and `task add <label>` or `task start|done|skip|pending|remove <number|id>` edits it.
`--eta` combines with any change, so revise the estimate with each tick. `lock-admins` and
`unlock-admins` turn admins away too (Builder included) while the host works. `--json` prints the
state document. The supervisor serves the page, so it stays reachable while the app restarts, but
not while the supervisor itself is stopped.

Do not stop, signal or relaunch `box dev` from a Builder turn, and do not start a second Box against
the same instance. If `box app status` or `box app restart` cannot reach the supervisor, stop and ask
the host operator to restore it. A supervisor started from older source than the checkout may lack
newer control operations until the host operator restarts it once (status then says the frontend
state is unknown).

`box auth login <id>` creates a compact, single-use sign-in URL and offers five seconds to press
Enter and open it in the default browser. It exits without opening when the countdown reaches zero;
redirected and non-interactive output never waits. Sign-in URLs use `/login/<grant>`. The current
`bl2` grant is typically about 50 characters, while unexpired `bl1` grants remain compatible.

`box auth replace <old> <new> [--name "Name"]` changes an agent's id by replacement on a stopped
Box: the new agent takes over the old one's configuration and the old one retires with its history
kept. See [AUTH.md](AUTH.md#agent-identity-and-role).

Both development and production starts enter the Box supervisor. The supervisor owns the stable
Builder/recovery surface at **/builder**, its **/builder-assets/** snapshot assets and the
editable application lifecycle. **box dev** serves every page through Vite; **box start** (or
**box start --prod**) serves the promoted web release to everyone and Vite only to the Builder
Preview, see [SERVER.md](SERVER.md#built-mode-one-release-for-everyone-vite-for-the-builder-preview). Builder control actions are authenticated Box operations and do not start a provider
turn implicitly.

## Stack source

`box stack where` and `box stack fetch` locate the Stack that this Box adapts recipes from. The
recipe documents already ship in the Box under `recipes/`; these commands provide the reference
implementation under `features/<id>/`. Both read `stack.source` from `box.json`, with any
`box.local.json` override; see [CONFIGURATION.md](CONFIGURATION.md#stack-source).

```sh
box stack where
box stack fetch
box stack fetch --ref <rev>
box stack fetch --ref <rev> --quiet
```

`box stack where` prints the configured source, its kind (path, git, or git from GitHub shorthand)
and its resolved location. For a path source it also prints `HEAD`, whether the checkout has
working-tree changes, and whether `recipes/` and `features/` exist. For a git source it prints the
`.stack/` cache and the commit it holds, or that nothing has been fetched yet.

`box stack fetch` returns a readable Stack and prints its path and commit. For a path source it
checks that the directory contains `recipes/` and `features/` and never modifies it; when `--ref`
names a different commit than its `HEAD`, it warns on stderr and still returns the path. For a git
source it clones into the gitignored `<box>/.stack/` cache on first use, fetches on later runs, and
checks out the requested revision detached. Without `--ref` it uses `origin/HEAD`, the remote's
default branch. A `--ref` is looked up as a remote branch first, then as any revision the cache
knows, and finally fetched directly by name. A revision starting with `-` or containing whitespace
is refused. The `.stack/` cache is gitignored and denied by the Vite dev server.
The cache is disposable: the command refuses a `.stack/` that is not a checkout of the configured
source, and deleting it is always safe. `--quiet` prints only the path, so an agent can use
`$(box stack fetch --ref <sha> --quiet)/features/<id>`. Pass the Stack revision recorded in the
Box's `docs/UPSTREAM.md` so the implementation matches the recipe documents. Git runs with the
user's own credentials; the Stack repository is private until it becomes public.

## Development console

`box dev` uses a live terminal view when stdin and stdout are terminals. It keeps the latest 2,000
supervisor, application and Vite lines in memory, while the selected log level controls only what is
visible. Raising verbosity therefore reveals earlier buffered messages. Redirected output switches
to append-only lines.

```sh
box dev                         # info
box dev --log-level warn
box dev --log-level verbose
box dev --debug                 # alias for --log-level debug
box dev --plain                 # append-only, no live terminal
```

Levels are `error`, `warn`, `info`, `verbose`, and `debug`. HTTP, proxy, WebSocket and heartbeat
diagnostics are debug; lifecycle waits and control operations are verbose. Common Nest route and
dependency startup messages are verbose. Errors and warnings remain visible at the normal `info`
level.

In the live view, Up/Down and Page Up/Page Down inspect buffered logs, `v` cycles verbosity, `r`
restarts the application, `f` restarts the Vite frontend, `c` clears the buffer, and `q` or Ctrl+C
shuts down cleanly. Vite HMR remains automatic and does not need a shortcut.
Use `bun run verify` or `packages/cli/bin/box verify` before installing the shim.

See [BUN.md](BUN.md) for the runtime. Subprocess cancellation and live rendering are
exercised on macOS/POSIX. Windows uses `taskkill`; Windows behavior has not been field-tested.

`box builder refresh` rebuilds the saved Builder UI through the running local supervisor. It keeps
the current version if the build fails and does not restart the shared session. Open Builder tabs
offer a reload after success. See [Builder](BUILDER.md#refresh-the-builder-ui).

## Builder browser control

`box builder browser` controls the first available Builder Preview from the local host. Use
the session id supplied by Builder. The command works with both Codex and Claude sessions without injecting MCP tools into
the engine. It uses the owner-only `data/builder/browser.sock` transport and keeps browser control
separate from WorkerDeck frames.

```sh
box builder browser --session <session-id> snapshot
box builder browser --session <session-id> inspect '{"ref":"dom-preview-1"}'
box builder browser --session <session-id> click '{"ref":"dom-preview-1"}'
box builder browser --session <session-id> type '{"ref":"dom-preview-1","text":"hello"}'
box builder browser --session <session-id> select '{"ref":"dom-preview-2","value":"active"}'
box builder browser --session <session-id> scroll '{"x":0,"y":600}'
box builder browser --session <session-id> style '{"ref":"dom-preview-1","styles":{"backgroundColor":"#eef"}}'
box builder browser --session <session-id> navigate '{"path":"/signals"}'
box builder browser --session <session-id> screenshot
```

Operations return bounded JSON. `snapshot` creates bounded DOM references for `inspect`, `click`,
`type`, `select`, `scroll`, and `style`; `screenshot` saves a DOM PNG under `_docs/browser/` and
returns its absolute path. Preview control is revoked by navigation or reload, disconnecting the
selected browser, or five minutes without an action. Switching to Files or opening Wrap Up keeps Preview
control available.
Authentication and settings routes, private fields, secret-like controls, scripts, frames, media,
and cross-origin assets are excluded. DOM screenshots are capped at 1600 pixels per side and 4 MB
and do not embed fonts. Click rejects native form submission, new-tab links, and downloads. Secret
detection is heuristic and DOM capture is bounded; this is not an OS sandbox or an OS-level screen
capture. Navigation is queued, then invalidates the old references when the route changes; take a
fresh snapshot after granting the new Preview state, because navigation has no full after snapshot.
