# `chat` - team chat, and the agent's seat in it

Rooms, threads, mentions, reactions, attachments, read pointers and a live multiplexed feed - plus
`nova`, the service account that answers when you mention it in a channel. The biggest feature in the
Box (~58 files, ~20k lines). Its tables are in the `chat` schema of the Box database; attachment
bytes are files. Everything else it touches - who the users are, who the agent's worker profile is -
it reads from core.

- **dependsOn**: nothing. Chat is a root of the dependency graph; it imports core (`io.ts`,
  `auth/principal.ts`, `users/state.ts`, `ops/*`, `warehouse/*`) and no other feature.
- **Depended on by**: `notifications` (`dependsOn: ['chat', 'automation']`) - the bell, web + FCM push,
  and alert delivery into chat rooms. It is glue, and it lives entirely on chat's store and chat's
  bus: `onChatEvent` for delivery, and chat's tables (`chat_mentions`, `chat_notification_reads`,
  `chat_notification_dismissals`, `chat_push_subscriptions`, `chat_device_tokens`) through
  `chatStore()` for its state. Remove or adapt `notifications` before removing `chat`.
- **Removal**: remove the feature's `core`, `server`, and `web` source trees only after
  dependent registrations have been adapted. The `chat` schema and `data/chat-uploads/` are left
  in place - they are the team's messages, not the feature's.

## Tables (schema `chat`, `features/chat/core/models.ts`)

| Table | Holds |
|---|---|
| `chat_rooms` | id, slug (unique), name, topic, `kind` (`room` \| `dm`), `mode` (`open` \| `members`), icon, `head_at` (the order-key guard), `agent_toolset`, created/updated |
| `chat_room_members` | who belongs to a `members` room: a DM's pair, or a named room's member list (room, user, added_at, added_by) |
| `chat_room_agents` | agent seats in named rooms (room, agent, added_at/by, `disabled_at`, `disabled_reason`) |
| `chat_read_pointers` | one user's read pointer in one room (`last_read_at`, an order key) |
| `chat_messages` | messages; `created_at` is the room's order key (unique per room), `meta` jsonb (cards), `parent_id` (thread root) |
| `chat_events` | the outbox: one `message.created` per message, `id` the global feed cursor |
| `chat_event_head` | one row, `last_id`: the outbox id counter |
| `chat_mentions` | the bell's mention rows (and in a DM, the agent's guest pass) |
| `chat_reactions` | (message, user, emoji) |
| `chat_attachments` | upload rows; the bytes are the file at the `sha256` address |
| `chat_agent_sessions`, `chat_agent_budgets` | one agent's worker session and turn budget per room |
| `chat_notification_reads`, `chat_notification_dismissals` | the bell's per-user watermarks and tombstones |
| `chat_push_subscriptions`, `chat_device_tokens` | Web Push subscriptions and mobile FCM tokens |

Times are epoch milliseconds in `bigint` columns: `chat_messages.created_at` is the order key every
cursor, pointer and outbox row is expressed in. Foreign keys cascade from rooms and messages, except
`chat_attachments.message_id` and `chat_messages.parent_id` (`no action`): a message's deletion
removes its attachment rows and its replies explicitly, so a path that forgot would fail rather than
strand blobs. Indexes are the feature's baseline (`CHAT_BASELINE`). Migrations run on the common
runner (`core.schema_migrations`, keys `chat:<name>`): `chat:001-default-room` seeds `#general` on a
fresh Box. `chat_rooms`, `chat_room_members` and `chat_room_agents` are policy tables
(`policyTable: true`, docs/WAREHOUSE.md): the policy service writes mode, members and seats in the
same transaction as the role changes they are judged with.

**Who may read a room.** `mode = 'open'`: every principal with chat access. `mode = 'members'`: the
room's `chat_room_members` rows. A DM is always `members` (a CHECK pins it, and pins `kind` to the
`dm:` slug namespace); a named room is either. One exception, in code only: a configured agent may
read and post in a DM between two people while a surviving message there mentions it (its guest
pass, the mention row). A read pointer is separate per-user state: opening an open channel writes a
pointer, never a membership.

## Its store (`features/chat/core/store.ts`)

`chatStore()` returns the process-wide `ChatStore` (its blob directory `data/chat-uploads/`); a test
constructs `new ChatStore(dir)`. Every method is one asynchronous executor transaction on the
current context's login, after a `chat` area check:

- A person's request runs on their role's login; the database grants back the check.
- A reader's own read pointer (`markRead`) and the bell's per-user state (watermarks, dismissals,
  mention seen stamps, push subscriptions and device tokens, reachable without chat access) run as
  named system entries after the check, as do the push transports' delivery state, the agent's
  trigger reads and the boot sweeps (listed in `packages/core/src/system-entries.test.ts`).
- **Publish after commit.** Every bus event is queued with `afterCommit`: a rollback announces
  nothing, and an enclosing transaction delays the events until it commits.
- **Order keys** are issued by the room's guard: `UPDATE chat_rooms SET head_at = greatest(head_at
  + 1, now)`, which also locks the room for the posting transaction. Mutations in a room (post,
  delete, reshape) lock the room row, so a reply can never land under a root being deleted.
- **Outbox ids** come from `chat_event_head`: the posting transaction bumps it as its last write and
  holds the row until it commits, so ids commit in id order, are never reused (a rollback takes the
  bump back, a deleted message leaves a gap), and the counter travels with the rows in a restore
  point. Publication is not ordered: each transaction publishes after its own COMMIT
  acknowledgement, so event N can reach the bus after N+1. The feed therefore treats a bus event as
  a wakeup: an event that is not the next id makes it drain the outbox after its cursor in id order
  (access-filtered) before the cursor moves past it. Resume (`id > cursor`) and live delivery read
  the same order.
- **Blobs** are written before the row that names them, and collected only when a fresh read finds
  no committed row naming the sha, both under one in-process lock per address; the sweep's directory
  pass leaves files younger than the orphan window (24 h) alone. A committed row therefore always
  names bytes that exist; a blob whose row never committed is garbage the next sweep collects.
- **Readability snapshot.** Core's agent-session rule is synchronous (workerdeck's `canSee`), so
  `canReadRoomNow` answers from an in-memory map of room modes and members, loaded at boot
  (`loadRoomAccess`) and updated after every commit that creates or deletes a room or changes its
  members.

Attachment **bytes** are not in the database: `blobs.ts` content-addresses them under
`data/chat-uploads/<sha[0:2]>/<sha>`, git-objects shaped (temp file and rename).

## Ports it owns, and what it registers into core

- **`onChatEvent` / `emitChatEvent`** (`bus.ts`) - the in-process chat bus. `ChatStore` publishes
  each COMMITTED outbox row (plus outbox-less per-user ephemerals) here, and only after the
  transaction commits. Deliberately **not** core's `changes.ts` bus, which is payload-free by design;
  chat frames carry message bodies, so safety comes from the server filtering each subscriber by room
  membership before yielding. Registered into by `notifications/delivery.ts` and by this feature's own
  `chat-agent.ts`.
- **`chatStore()`** - the store handle itself is the second port. `notifications` reads and writes its
  tables through it; core's agent host uses the readability snapshot (`canReadRoomNow`).
- **Into core's run funnel**: one `ActionSpec` (below).
- **Not** registered: chat subscribes to no core `onEvent`, registers no `onRunOutcome`, and
  contributes no web `slots`.

## The agent seat

The `agent` block of the root `box.json` selects the identity before first boot; `systemUserId()` reads it lazily.
The default is Nova (`nova`), admin. Chat uses this same identity for mentions, DM guest access,
loop guards, prompts, approvals and worker-session ownership. The browser gets it from auth, so
its mention picker and system badge do not hardcode a name. Examples below use the default ID.
See [identity and role](../../docs/AUTH.md#agent-identity-and-role), including the admin tradeoff.

**What arms it.** `startChatAgent()` runs from `ChatModule.onModuleInit` unconditionally, and

```
armed = boxJson().background.chatAgent  AND  agentWorkerUrl() !== undefined
```

Both halves, or no turn ever runs. `background.chatAgent` is a boolean that defaults to `false`.
`agentWorkerUrl()` comes from core's workerdeck host
(`apps/server/src/agent/workerdeck.host.ts`), which boots only when the `workerdeck` section of
`box.json` declares a deployment. It is its own flag rather than riding `background.automation` so that "test the chat agent on
dev" does not also arm every production schedule.

**What is armed regardless of the flag**, deliberately:

- `expireOrphanedCards()` at startup - a card the last process left `pending` is a promise this one
  cannot keep, and the flag having just been turned off is exactly when stale cards exist.
- `decideApproval` (behind the card buttons) - since chat-op approvals it answers cards no agent
  raised. It runs no turn, creates no session and does no MCP write.
- `startChatOpApprovals()` from the same `onModuleInit`, for the same reason.

**How nova answers.** Three doors, resolved in core by `resolveAgentTrigger` and deduped by
`AgentMessageClaims` (one message, one turn): an explicit `@nova` mention; a reply inside a thread the
agent already owns; any message in a DM with nova. In a named room the answer goes in a thread rooted
on the question (a long turn must not interleave through a room people are using); in a DM it goes at
top level. `parseAgentDirective` recognises exactly one non-turn directive - `stop` or `cancel`, with
an optional trailing `.`/`!` - and it never counts against the budget. Budget: `AGENT_TURN_BUDGET = 25`
(or `features.chat.agentTurnsPerHour`) turns per room per `AGENT_BUDGET_WINDOW_MS` (1h). A turn is seeded with `AGENT_SEED_HISTORY = 10`
recent messages plus whatever is new since the session last looked; `chat-history` over MCP is how it
reaches further back. Each ask names the asker's user id and identity email (from the users
directory, read per turn); `user-get` and `users-list` give the agent anyone's profile, so a tool
that acts for a person (a mail or calendar account) takes that person's email from there.

**Seats and coverage.** An agent answers and posts in a named room only from an enabled seat
(`chat_room_agents`). In a `members` room it also needs every member to cover it (docs/AUTH.md
"Agents and coverage"). An `open` room trusts its seated agents: everyone with `chat` read sees
what they write there, with no coverage check, so only an admin seats or enables an agent in an
open room or opens a room that has enabled seats. In a DM the readers are the people in it. A turn without a seat or coverage is refused with a generic note in the room, naming nobody.
Admins and the room's creator change mode, members and seats in the room's settings
(`chat-room-access-set`) through the policy service: a change that would leave a reader who does not
cover a seated agent is refused with the list, or, for existing members of a `members` room,
confirmed with the preview's revision, which also removes them. Removing a seat never opens a room;
opening a room drops its member rows. A seat found uncovered by a policy change or the boot check is
disabled with its reason until an admin enables it. Live `room:` sessions end on the policy revision
that breaks their coverage. The room's agent toolset is set through the policy service too.

**More than one agent.** Every agent from [docs/AUTH.md](../../docs/AUTH.md) ("More agents") has its
own seat: sessions, claims and turn budgets are keyed by room and agent, so one message that
mentions several active agents starts a turn for each. An unaddressed follow-up in a thread goes to
the agent whose answer completed last there. An agent's finished answer (never a card, checkpoint
or failure notice, and never its own `chat-post` calls) that mentions another agent hands that agent
a turn. `agentHop` in the answer's meta counts the chain (a person's message is 0) and
`AGENT_HOP_LIMIT = 3` stops it with a visible note. The hop limit bounds chain length, not fan-out;
the per-agent room budget bounds the total. A member agent that mentions an admin agent invokes the
admin agent's authority, as a member person can. Approval cards are decided by a person only.

**The host.** `chat-agent.ts` creates a workerdeck `SessionHandle` per room against
`agentWorkerUrl()` with `hostAuth`, under the agent's default profile (`users.agent_profile`, set on
its user detail; unset means Claude first among its `agentProfiles`), resolved as
`agentProfileFor(agent, preferredAgentEngine(agent))` (no profile = the turn throws). A room's live
session is retired between turns when that default changes. Per engine
(`CHAT_AGENT_TUNING_DEFAULTS` in `core/agent-tuning.ts`, overridable in `features.chat.agentModels`):
Codex `gpt-5.6-luna`, Claude `claude-sonnet-5-5`, reasoning effort `medium`, each probed against the profile's
catalogue first and **omitted if the profile does not declare it** rather than failing (logged). Sessions close after
`SESSION_IDLE_TTL_MS` (1h idle); a turn that emits nothing for `TURN_SILENCE_LIMIT_MS` (10min) is
interrupted, with the watchdog standing down while the turn is legitimately blocked on an approval.
**The agent's Box MCP server.** On an engine that takes per-session MCP servers (Claude; the
profile's `capabilities.sessionMcpServers`), the session is created with the Box's own MCP server as
`box` (`http://127.0.0.1:<server.port>/mcp`, Bearer a session credential for the agent scoped to
`room:<id>`, closed when the session is dropped; docs/AUTH.md "Session credentials"), `allowedTools: ["mcp__box"]` and the floor `CHAT_AGENT_BOX_MCP_FLOOR` (`ServiceRestart`,
`UserDelete`, `UserSetRole`, `UserAccessRevoke`) as `mcp__box__<Tool>` in `disallowedTools`. A
`box` entry in the profile's own config is replaced for that session, not run beside it. Codex
takes the same session options; it honours only MCP entries in the tool lists, which the floor is
(`capabilities.toolFilters`, docs/AGENT-TOOLS.md "Engines"). Without the server an agent has no Box tools and
falls back to the shell, which raises an approval card per command.

**The room's toolset.** A room may name an agent toolset (`rooms.agent_toolset`, migration
`016-room-agent-toolset`; [docs/AGENT-TOOLS.md](../../docs/AGENT-TOOLS.md)). Its servers, `allow` and
`deny` are added beside `box` when the room's session starts, and a session whose room now names a
different toolset is retired between turns, like a profile change. `chatRoomToolset` (tRPC only)
reads it for anyone who can read the room and sets it for an admin who is not the agent; Room
settings shows it to admins. No toolset means the Box's tools only.
Text is assembled by `AgentTurnText` from `stream_delta`s and `assistant_message` blocks and
checkpointed into the room's placeholder message roughly twice a second.

**Before every turn**: `verifyLoopback()`. nova's tools dial the literal `127.0.0.1:<port>/mcp` out of
its own config, so a turn is only safe when that address is this process. If it is not, the turn is
refused loudly in the channel rather than degraded. Read the incident note at the top of
`apps/server/src/agent/loopback-guard.ts` - this guard exists because a VS Code port forward once made
a dev machine's agent write to production.

**Approvals** (two kinds, one card format, one decision endpoint):

- *Worker approvals* - `permissionMode: 'default'`, so reads are free and every Bash/Edit/Write raises
  a permission request. A request that settles inside `APPROVAL_HOLD_MS` (3s) never reaches the room;
  past that it becomes a real message anyone who can read the room may approve or deny, capped at
  `APPROVAL_CARDS_PER_TURN` (8) per turn, with the worker's own timeout at `APPROVAL_TIMEOUT_MS`
  (30min). `CHAT_AGENT_DISALLOWED_TOOLS` is the hard floor for the engine's own tools and is
  **empty on purpose** - the seam exists so adding a name later is one line. Box MCP tools are
  auto-approved instead, above `CHAT_AGENT_BOX_MCP_FLOOR` (system and user-lifecycle tools), which
  no card can unlock. `AskUserQuestion` is still `deny`: a binary card cannot
  carry an answer form.
- *Chat-op approvals* (`chat-op-approvals.ts`, core rule + server registry) - a DESTRUCTIVE chat
  operation asked for by an API client. `chatOpNeedsApproval` keys on **how the principal
  authenticated**, not on transport: anything that is not demonstrably a `session` credential, plus
  the service account whatever it presented, is held. Today exactly one op kind: `room-delete`. The
  tool call returns `status: 'pending'` immediately, the card waits in memory (a restart expires it),
  and approving EXECUTES the delete with the approver as actor of record.

**Safety posture, as the code states it**: MCP authenticates as `nova`, an admin, and reach is full by
decision - anyone who can mention `@nova` effectively wields nova's whole MCP surface. What bounds it is
the permission mode, the in-channel approvals, `canReadRoom` on every read, and the two floors
(engine tools, Box MCP tools). Chat bodies are untrusted input to an admin-credentialed loop: bounded, not solved.

## Procedures and tools

`ChatController` (`@Controller('chat')`, class-level `@UseGuards(AuthGuard)`). Every write is stamped
with the request principal - never a client-supplied id. Reads that take input are POST +
`@Trpc({ kind: 'mutation' })`, the house pattern; only the input-less query is a `@Get`.

**16 tRPC procedures, 12 MCP tools, 2 plain REST routes.**

| tRPC | MCP | what |
|---|---|---|
| `chatRooms` (query) | `chat-rooms` | the sidebar: the principal's rooms with unread counts plus joinable public rooms. Over MCP this is the discovery call |
| `chatHistory` (mutation) | `chat-history` | one room's messages, paging backwards by `createdAt`, returned oldest-first. The agent's memory |
| `chatThread` (mutation) | `chat-thread` | one thread expanded - the companion to `history({ roots: true })` |
| `chatPost` (mutation) | `chat-post` | send a message. Carries the double-post guard: nova may not `chat-post` into a room where its own turn is already streaming |
| `chatEdit` (mutation) | `chat-edit` | replace your own message's body; sender-only, issues no key and no outbox row |
| `chatReact` (mutation) | `chat-react` | toggle one of the twelve palette emoji (`CHAT_REACTION_EMOJI`) |
| `chatDelete` (mutation, `@Trpc({ name: 'Chat.delete' })`) | `chat-message-delete` | delete a message; `moderate: true` for any sender |
| `chatRoomCreate` (mutation) | `chat-room-create` | create a room. It starts `open`: everyone with chat access can read and write it at once |
| `chatRoomAccess` (mutation) | `chat-room-access` | a room's mode, members and seats, and for the member picker every person with chat access with the reason they cannot join. Any reader of the room |
| `chatRoomAccessSet` (mutation) | `chat-room-access-set` | change mode, members or seats (admins and the room's creator, never an agent). `preview` returns the coverage violations; a refusal returns `{ applied: false, refused }`; `revision` with `confirm: 'remove-members'` also removes the listed members; a stale revision is 409 |
| `chatDirectOpen` (mutation) | `chat-direct-open` | open a DM with one person. Idempotent: the slug is `dm:<a>:<b>` from the sorted pair |
| `chatRoomUpdate` (mutation) | `chat-room-update` | rename / topic / icon. Empty string clears; a DM answers 400 |
| `chatRoomDelete` (mutation) | `chat-room-delete` | PURGE a room. Three guards: `confirm` must repeat the slug, an API client gets an approval card and `status: 'pending'`, and the store requires readability |
| `chatBackup` (mutation) | `ChatBackup` (bare `@Mcp()`, name derived) | copy new attachment blobs to GCS through the recorded run funnel |
| `chatMarkRead` (mutation) | - | advance the member's read pointer (clamped, monotonic) and get the server's unread recount |
| `chatAgentStatus` (mutation) | - | what the turn in this room is doing right now; covers a late joiner and a reconnected feed, since `agent.activity` is ephemeral |
| `chatAgentDecision` (mutation) | - | approve or deny an approval card. **Any** user who can read the room may answer, worker cards and chat-op cards alike |
| `chatFeed` (subscription) | - | ONE multiplexed live stream per client over every room the principal belongs to. A `cursor` replays the outbox, then it goes live; every frame is membership-filtered server-side, and a member removed from a room gets `room.left` |

Plain REST, because multipart does not project onto tRPC or MCP:

| route | what |
|---|---|
| `POST /api/chat/attachments` | multipart upload, field `file`. 25 MB cap, mime allowlist (images, pdf, text, csv, markdown, json, archives; `text/html` and `image/svg+xml` deliberately excluded). The result is an ORPHAN until a `chatPost` claims it; orphans are swept after 24h |
| `GET /api/chat/attachments/:id` | stream the bytes. The URL is **not** a capability - every request re-runs `attachmentForRead`, which is uploader-only during the orphan window and exactly `canReadRoom` afterwards |

## Actions

One, in `actions.ts`:

| id | group | what |
|---|---|---|
| `chat-backup` | Warehouse | Copy new `data/chat-uploads/` blobs to `chat/uploads/` in the private GCS bucket (never deletes remotely). Chat's rows travel in the database restore points (`box db backup`) |

It is in core's action registry, so `automation` can schedule it and every invocation lands in
`automation_runs` - the `chatBackup` procedure calls `executeRecorded('chat-backup', …)` rather than
`backupChat()` directly.

## UI

- **Routes**: `/chat` (`ChatLayout` - the room list as sidebar, one room through the `Outlet`) with
  two children, the index and `$room`. `$room` is the room **slug**, not its id, because that is what
  every server procedure keys on and what people say out loud. Landing on `/chat` with no room
  forwards (`replace`) to the first channel, preferring a named room over a DM.
- **Nav**: one entry, `Chat`, icon `MessagesSquare`, order band **500**.
- **Settings / shell / slots**: none. The bell in the topbar is `notifications`, not chat.
- **`onSession`**: `startChatFeed()`. The feed arms on every route as soon as a session exists, not
  lazily with the first chat surface, because anything app-wide that counts on it (the bell) has to
  see it live from the start. `useChatData.ts` owns the single module-scope `chatFeed` subscription
  per tab, its cursor and its reconnect loop - chat does not ride the changes bus.
- The composer is behind a lazy chunk (`ComposerLazy.tsx`), like sink's editor.
- Composer keys: Enter sends (inside a list or code block it makes the next line; Mod-Enter sends
  from there), Shift+Enter makes a line break. Markdown block markers (`- `, `1. `, `> `, `# ` to
  `### `, ```` ``` ````) format live at the start of the message and at the start of any line after a
  line break (`lineStartShortcuts.ts`); on a touch keyboard Enter makes a new line.

## Settings

| setting | doc |
|---|---|
| `background.chatAgent` (core, `box.json`) | `true` arms the chat agent (nova answers in rooms); `false`, the default, leaves it off |
| `features.chat.agentModels` (`box.json`) | Per engine `{ "model", "reasoningEffort" }` over the defaults, field by field, e.g. `{"claude": {"model": "claude-haiku-5-5"}}`. Engines `claude`, `codex`; values are exact model ids (`claude-sonnet-5-5`, `claude-haiku-5-5`, `gpt-5.6-luna`). Invalid entries are logged and ignored. Takes effect for new sessions after a server restart |
| `features.chat.agentTurnsPerHour` (`box.json`) | Agent turns per room per rolling hour, a whole number of at least 1; default 25 (`AGENT_TURN_BUDGET`). Read on every mention, no restart needed |

The feature reads no environment variables. The agent seat additionally depends on the
`workerdeck` section of `box.json` (which is what makes `agentWorkerUrl()` non-undefined) and on
`server.port`, through the loopback guard.

## Admin-only

Since 2026-09-13 the Box has two tiers (`docs/AUTH.md`, "The two tiers"), and the rule every feature applies is
one sentence: **an operation is admin-only when its blast radius is another person's identity or
credential, the service itself, or configuration wired to credentials.**

This feature's admin set is the `moderate` flag on `chat-message-delete` (checked with `assertAdmin`, not a decorator - the
same route is every member's ordinary self-delete, and only the flag tells them apart).

Everything else in chat is a member's, rooms included: a room is a conversation, not configuration.

## What a team customises

1. **Room seeds** - there are none. No migration and no boot path creates a room; the first channel is
   created by a person (or by `chat-room-create`) after the Box boots. A team that wants `#general`
   day one creates it.
2. **The agent's identity** - select it in the `agent` block of the root `box.json` before first boot.
   Core seeds the matching user; changing the ID later is unsupported. The agent also needs an entry in `agentProfiles` mapping it to a real workerdeck profile.
   Its profile gets the Box MCP server from the session (Claude and Codex). Its default profile (Settings > Users, the agent's detail) picks the
   engine; `features.chat.agentModels` in `box.json` sets the model and effort per engine (see
   Settings), and both degrade rather than fail if the profile does not declare them.
3. **Labels and order** - the nav entry's `label` and `order` in
   `features/chat/web/index.tsx`. Band 500 puts chat mid-sidebar.
4. **Vocabulary** - `CHAT_ROOM_ICONS` (69 curated lucide names) and `CHAT_REACTION_EMOJI` (12, in UI
   order, first six on the hover bar) in `types.ts` / `reactions.ts`. Both lists exist in the Flutter
   client too; add to one and check the other.
5. **The agent's bounds** - `CHAT_AGENT_DISALLOWED_TOOLS` (empty by design), `CHAT_AGENT_BOX_MCP_FLOOR`,
   `CHAT_AGENT_PERMISSION_MODE`, `AGENT_TURN_BUDGET`, `SESSION_IDLE_TTL_MS`,
   `TURN_SILENCE_LIMIT_MS`, `APPROVAL_*`. Shape these from watched usage, not from a guess.
6. **Attachment policy** - `ATTACHMENT_MAX_BYTES` and `ATTACHMENT_ALLOWED_MIME` in
   `chat.controller.ts`. Allowlist, never deny-list.
