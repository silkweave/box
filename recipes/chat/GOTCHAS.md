# chat gotchas

Chat's tables are in the `chat` schema of the Box database and its migrations run on the common runner (`core.schema_migrations`, keys `chat:<name>`); the runner takes a `pre-migrate` restore point before a pending migration or a changed model. Attachment bytes are files under `data/chat-uploads/` and are not in a restore point: back them up with `chat-backup` or the file backup.

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
- **Never edit, rename or reorder a shipped migration.** The key is `chat:<name>` with a checksum;
  new behaviour is a new migration.
- **Do not start an agent turn from inside a write.** `ChatStore.post` commits message + mentions +
  outbox in one transaction and publishes on the bus strictly after (`afterCommit`); that is why
  `chat-agent.ts` and `notifications/delivery.ts` are both bus subscribers. A worker's REST latency
  inside the posting transaction would hold the room's row lock and the outbox counter.
- **The outbox counter is the feed's order; the bus is not.** `chat_event_head` is bumped last in
  the posting transaction and held until commit, so ids commit in id order. Bus events can still
  arrive out of order (each follows its own COMMIT acknowledgement), so the feed drains the outbox
  on a gap instead of trusting callback order; do not deliver from the bus payload alone past a
  gap. Do not replace the counter with a sequence,
  and keep any new write that adds outbox rows going through `post`; an import sets `last_id` to the
  highest imported id, or the next post collides.
- **The store is asynchronous; the agent's writes are ordered.** A checkpoint that overtook a turn's
  final write would cut the answer short, so `chat-agent.ts` queues writes per message and per
  session row. Keep new fire-and-forget writes on those queues.
- **A blob before its row, a collection after its rows.** Write the bytes first, collect only after
  the referencing rows are committed gone and a fresh read finds none, under the per-address lock
  (store.ts "Blob sequencing"). A sweep never removes a file younger than the orphan window.
- **Core's agent-session rule is synchronous.** It reads the store's in-memory readability snapshot
  (`canReadRoomNow`); a new write that changes a room's mode or members must update it after commit
  (`noteRoomAccess`) or the transcript readers drift from the room's readers.
- **Tests** construct `ChatStore` with their own blob directory and empty the chat tables between
  cases; the per-file database clone is the cluster's (`vitest.setup.ts`).
- **Import `ComposerLazy`, never `Composer`.** The composer pulls in the rich editor; the room list
  does not need it.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it (`AGENTS.md`). Chat's
  `onSession` hook makes this sharper than most: it runs on every route for every session.
- **After a controller change, run `bun run typegen` before checking the web types.** The full
  `box verify` chain does this automatically. Tests resolve core from source; keep their source
  aliases intact so instance overrides and domain code share the same state.
