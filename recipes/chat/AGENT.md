# Adapting the `chat` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a Box
and what to change afterwards. Chat is the largest feature in the Box and the only one with its own
database engine, so read the Gotchas before you arm anything.

## 1. Integrate

The recipe documents ship with core at `recipes/chat/`; the reference implementation is fetched from the recipe registry as `features/chat/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box recipe fetch chat`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched recipe>/features/chat/` into the Box's `features/chat/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the fetched version and sha256 in the `recipes` ledger of `box.json`, and the path mapping and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

Chat has a private SQLite ledger keyed by migration object name and stores no checksum. Preserve every shipped name, body, order, and runner. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

### Mobile module

When the owner wants chat in the mobile app, integrate `features/chat/mobile/` as described in
the [Mobile app powerup](./powerups/mobile/INSTALL.md). It adds the Chat tab (order 10), the
`chat/room/<slug>` link, the `box_chat` Android channel (which must equal `channel_id` in the
notifications feature's `fcm.ts`) and foreground notifications for messages in other rooms. Its
tab label, icon and order live in the module declaration in `features/chat/mobile/lib/`.

## 2. Customise for the team

1. **Create the first rooms.** Nothing seeds them - no migration, no boot path. After the first boot,
   make them in the UI or over MCP: `bun run cli chat-room-create` with a slug, and optionally a `name`,
   `topic` and `icon` from the 69-name `CHAT_ROOM_ICONS` list.
2. **Read the agent's identity** from the `agent` block of the root `box.json`, chosen before first boot. The
   default is Nova (`nova`), admin; ID changes after initialization are unsupported. Core seeds
   its directory row. Read [the role tradeoff](../../docs/AUTH.md#agent-identity-and-role) before
   arming chat. The seat also needs an entry in
   `agentProfiles` (`box.json`, or `box.local.json`) mapping it to a real workerdeck profile, its
   default profile chosen on its user detail (Settings > Users), and an access token for its MCP
   client (`box auth token`).
3. **Tune the turn** - `features.chat.agentModels` (model and effort per engine) and
   `features.chat.agentTurnsPerHour` in `box.json`;
   `SESSION_IDLE_TTL_MS`, `TURN_SILENCE_LIMIT_MS` in
   `features/chat/server/chat-agent.ts`. The model and effort are probed against the
   profile's own catalogue and silently omitted if it does not declare them, so a wrong value degrades
   to the profile default rather than failing.
4. **Decide the agent's floor** - `CHAT_AGENT_DISALLOWED_TOOLS` is empty on purpose. Add names once
   you have watched real turns: a tool that gets approved reflexively, or one whose blast radius
   nobody reading a one-line card can judge.
5. **Nav label and order** - `features/chat/web/index.tsx`. Band 500.
6. **Vocabulary** - `CHAT_ROOM_ICONS` and `CHAT_ROOM_NAME_MAX` in `types.ts`, `CHAT_REACTION_EMOJI`
   and `CHAT_REACTION_QUICK_COUNT` in `reactions.ts`. Both lists are mirrored in the mobile module
   (`features/chat/mobile`); its tests compare the icon list with `types.ts`, so change them
   together.
7. **Attachments** - `ATTACHMENT_MAX_BYTES` (25 MB) and `ATTACHMENT_ALLOWED_MIME` in
   `chat.controller.ts`. Keep it an allowlist; `text/html` and `image/svg+xml` are excluded because
   both execute script when a browser renders them from this origin.

There is no warehouse table to migrate and no seed to load. `chat.db` creates itself on first open.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/chat`. With no rooms yet you get the empty shell; **+** creates one and
the route forwards to it. Then, in one room: type a message (it appears without a refresh - that is
the `chatFeed` subscription, not a poll), hover it and react, reply to it to open a thread, drag an
image onto the composer, and open the same room in a second tab to watch the unread badge clear.
Check the instance directory `data/` afterwards: `chat.db`, `chat.db-wal` and `chat-uploads/` are really there.

Agent-side, the same operations are MCP tools:

```bash
bun run cli chat-rooms                 # discovery: what this principal can see
bun run cli chat-post                  # room + body
bun run cli chat-history               # room, before, limit, roots
bun run cli chat-room-create           # slug, name, topic, icon
bun run cli chat-direct-open           # user
bun run cli chat-room-delete           # room + confirm (the slug, repeated)
```

`chat-room-delete` over MCP is the one to try deliberately: it should come back
`status: 'pending'` with a card posted into the room, because the caller is a bearer-token client.
Approve it in the browser and watch the card settle in place.

**Arming the agent, safely.** Leave `background.chatAgent` false on any dev machine unless you are
deliberately testing against a worker you own. When you do arm it, set it in that checkout's
`box.local.json` and declare the agent's profile in the `workerdeck` section, then start `box dev`:

```json
{ "background": { "chatAgent": true } }
```

Both are required - the flag alone does nothing without `agentWorkerUrl()`. Then mention `@nova` in a
room. You should see a placeholder message appear under nova's avatar, an activity line describing what
it is doing, text streaming into the placeholder, and - the moment it wants to run a command or write
a file - an approval card with two buttons that anyone in the room can press. `@nova stop` cancels a
turn and does not count against the budget. If the turn instead posts "I am not running this turn",
the loopback guard refused it: something other than this process owns `127.0.0.1:8190`.

## 4. Adapt or remove

To update this feature, compare the target Box with the version recorded in the `recipes` ledger of `box.json` (fetch it with `box recipe fetch chat --version <that version>`), preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories (and `mobile`, with its `box_chat` entries in `apps/mobile/pubspec.yaml` and `apps/mobile/lib/generated/modules.dart`, when the Box included it) only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
