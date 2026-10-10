# chat gotchas

Back up chat.db before migrations. Chat applies migrations one transaction at a time, so an interrupted run may have completed a prefix. Inspect its ledger and restore the matching application/data pair when recovery is needed.

The feature id (`chat`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **`background.chatAgent` in `box.json` must be `true`** (a boolean; any other type fails
  configuration loading). It defaults to `false`. And the flag is only half of it:
  `agentWorkerUrl()` must also resolve, which means core's workerdeck host booted, which means the
  `workerdeck` section of `box.json` declares a profile for the agent's own account.
- **An agent with no Box MCP greps instead.** Observed on a team Box 2026-10-08: the agent's
  Claude profile had no MCP servers, so it answered Box questions through the shell, one approval
  card per command. Sessions carry `box` themselves (Claude and Codex). If the agent's answers start with file searches, check which
  tools its session lists.
- **The agent host is core's, the seat is chat's.** `chat-agent.ts` resolves the worker URL registered
  by core's workerdeck host; chat does not own a worker. The per-user agent SIDEBAR is a different
  thing entirely - browser-initiated, per-task, through the `/agent` proxy. The two share nothing
  but the worker process.
- **The loopback guard runs per turn, not once at boot.** Read the incident note at the top of
  `apps/server/src/agent/loopback-guard.ts` before touching `DEFAULT_PORT` (8190) or `server.port`. The
  failure it prevents is invisible: a VS Code Remote-SSH forward can own `127.0.0.1:<port>` while Node
  holds the IPv6 wildcard, and every MCP write from a "local" turn then lands on the other machine
  with nova's real credentials. A second Box must therefore never be one default away from the
  first: give it its own `server.port` and `server.vitePort`.
- **Never `cp` chat.db.** Recent commits live in `chat.db-wal`; a copied file opens perfectly clean
  and has silently lost the last hour. Use `VACUUM INTO` - which is what `chatBackup`,
  `backupChat()` and the pre-migration snapshot all do.
- **Never edit, rename or reorder a shipped migration.** The name is the ledger key in a database
  that is already deployed. Append `016` instead.
- **Do not start an agent turn from inside a write.** `ChatStore.post` commits message + mentions +
  outbox in one transaction and publishes on the bus strictly after; that is why `chat-agent.ts` and
  `notifications/delivery.ts` are both bus subscribers. Holding a worker's REST latency inside a
  SQLite write transaction is the one thing a single-writer file database must never do.
- **`chatStore()` is a process-wide long-lived handle.** Close it on shutdown (`closeChatStore()` in
  `onModuleDestroy`, timers stopped first) or WAL never checkpoints cleanly. Tests construct
  `ChatStore` directly instead.
- **Import `ComposerLazy`, never `Composer`.** The composer pulls in the rich editor; the room list
  does not need it.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it (`AGENTS.md`). Chat's
  `onSession` hook makes this sharper than most: it runs on every route for every session.
- **After a controller change, run `bun run typegen` before checking the web types.** The full
  `box verify` chain does this automatically. Tests resolve core from source; keep their source
  aliases intact so instance overrides and domain code share the same state.
