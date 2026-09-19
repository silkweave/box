# WorkerDeck on Bun: compatibility spike

Historical exploration: the subsequent [Bun migration](BUN.md) supersedes the runtime and CLI recommendations below. The recorded probe results remain unchanged.

Date: 2026-09-19. Status: promising for ordinary gateway and Claude/Codex operation, not a full compatibility pass or runtime migration.

## Versions and isolation

The reproducible upstream baseline is WorkerDeck `v2.7.2`, commit
`d1aea87c0ba389b37ce0fff333e495fede98adfb`, matching the Box's installed package version.
It was cloned into `/tmp/silkweave-workerdeck-bun-spike`. Dependencies were installed with
Bun 1.4.2 using `--ignore-scripts` and its migrated lockfile. Both runtime comparisons used
that same dependency tree and Vitest 4.1.11. Node was 24.15.0; the host is macOS arm64.

The maintainer's checkout at `/Users/atomic/projects/ai/workerdeck` was inspected read-only.
Its HEAD is `b37d565990432a0273375c22b0e302702248b4ac` (2.8.0), with uncommitted hot reload
work. The suite results below apply to the 2.7.2 tag, not to that dirty checkout.

No live Box instance, provider credentials, global runtime, lockfile, or WorkerDeck source
was changed. Native probes used temporary empty engine homes and did not submit model turns.

## Results

| Check | Node | Bun 1.4.2 |
| --- | --- | --- |
| Upstream core suite | 395 passed, 35 files | 335 passed, 48 failed; one additional suite failed to collect |
| Upstream server suite | 275 passed, 22 files | 274 passed, 1 failed |
| Upstream client suite | Not repeated | 21 passed, 2 files |
| Real Codex app-server initialization | Passed | Passed |
| Codex account/read and ephemeral thread/start | Passed, unauthenticated | Passed, unauthenticated |
| Real Claude auth subprocess | Expected logged_out | Expected logged_out |
| Direct Zod named import | Node suite passes | Passed outside Vitest |
| Bun identity inside Vitest worker | Not applicable | Confirmed 1.4.2 |
| Current hot reload API requirement | Not exercised | Named import of registerHooks fails |

The core tests include the real WorkerDeck runner implementations with scripted Claude/Codex
provider peers. They exercise event normalization, streamed events, approvals, interruption,
resume/backfill and replay. Server/client tests exercise actual loopback HTTP/WebSocket
transport, session ownership, parking/persistence, file routes and shell routes. They do not
prove paid provider calls or an uninterrupted real agent turn surviving a restart.

## Findings

### Vitest 4 and Zod import interoperability

The core failures concentrate in AI SDK/tool execution tests. A minimal additional test confirms
that `import { z } from 'zod'` yields an unavailable named export inside this Bun/Vitest setup,
while the same direct Bun import produces a usable `z.object` function. Zod is 4.6.5.

The same installed dependency tree passes the complete core suite under Node. This is evidence
of a test loader/runtime interoperability issue, not proof that the deployed AI SDK runner
cannot run under Bun. A candidate Vitest `server.deps.inline` rule for Zod did not fix it.
Resolve the harness issue and rerun the full suite before claiming compatibility; do not
suppress the tests or count the collection failure as skipped coverage.

### WebSocket shutdown ordering

`packages/server/test/server.test.ts`, test `closes while a session socket is still attached`,
fails under Bun because the client still reports OPEN immediately after `server.close()`
resolves. Waiting for the client to observe closure makes the focused test pass.

The implementation resolves on the HTTP server's close callback, does not await `wss.close`,
and clears the forced-WebSocket-termination timer in that HTTP callback. The latest local
WorkerDeck source has the same structure. Investigate the close contract on both runtimes:
coordinate HTTP and WebSocket drain before resolving, and keep the grace timer alive until
upgraded sockets have actually drained. A client-event wait improves the assertion but does
not by itself prove that uncooperative sockets cannot outlive shutdown.

### Current development hot reload is Node-specific

The maintainer's uncommitted `packages/cli/src/dev/hot-reload.ts` statically imports
`registerHooks` from `node:module`. Bun 1.4.2 fails that named import before a fallback can run.
The CLI imports this module dynamically when hot reload is selected, so this finding applies
to that option rather than all CLI startup.

Use a capability check and a clear unsupported fallback as the minimum improvement. A Bun
reload implementation needs an explicit design preserving runner identities and child
processes; substituting ordinary process watch/restart does not preserve an in-flight turn.
The existing local adoption seam and shared session store are relevant work to reuse.

## Reproduction

In the isolated upstream checkout, use the exact tag above. Run these from each of
`packages/core`, `packages/server`, and `packages/client`:

```sh
node ../../node_modules/vitest/vitest.mjs run
bun --no-env-file ../../node_modules/vitest/vitest.mjs run
```

Use Bun 1.4.2 explicitly; the machine's default Bun was not changed. The experiment used
`/tmp/silkweave-build-exploration-20260919/bun142/package/bin/bun`.

Minimal harness reproduction, placed under `packages/core/test/`:

```ts
import { expect, test } from 'vitest'
import { z } from 'zod'
test('runtime is Bun', () => expect(process.versions.bun).toBe('1.4.2'))
test('zod named export', () => expect(typeof z?.object).toBe('function'))
```

Direct import comparison: `bun --no-env-file -e 'import { z } from "zod"; console.log(typeof z.object)'`.
Hot reload prerequisite: `bun --no-env-file -e 'import { registerHooks } from "node:module"'`.

The local native-process probe is `_docs/spike/workerdeck-bun/native-process.mjs`.
It uses the installed 2.7.2 package, actual bundled engine executables, isolated empty homes,
and a timeout. Run with Node or `bun --no-env-file`. This is a process/stdio probe, not a model
response test. Its source and captured logs are local gitignored artifacts; this document
preserves the findings independently of them.

## Recommendation and remaining proof

Continue evaluating Bun, but retain Node/pnpm as the supported Box baseline. First resolve
or explain the test-loader failures, harden shutdown, and guard unsupported hot reload.
Then run one bounded authenticated turn per engine in an isolated checkout: stream output,
approve a file edit, inspect the result, interrupt a second turn, disconnect/reconnect the
client, and test idle-session recovery. Test preservation of an active turn separately from
parked-session recovery. Provider credentials and billing were not exercised in this spike.

The upstream handoff is `_docs/REQUEST-workerdeck-bun-compatibility.md` in this Stack checkout.
No request was sent externally and no upstream checkout was modified.

Sources: [WorkerDeck 2.7.2 source](https://github.com/workerdeck/workerdeck/tree/v2.7.2),
[Bun Node API compatibility](https://bun.sh/docs/runtime/nodejs-compat). Findings above are
from the recorded local tests; upstream documentation does not claim a full Bun pass.
