# Adapting the `notifications` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/notifications/`; the reference implementation lives in the Stack at `features/notifications/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** chat, alerts. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/notifications/` into the Box's `features/notifications/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No feature-owned migrations. Chat migrations remain in chat's private chain. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **Generate a VAPID pair** if this team wants browser push. Any web-push keygen does it
   (`npx web-push generate-vapid-keys`), then write three credentials into
   `box.local.json credentials` under channel `push`, account `*`:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or `https:` URL
   identifying you to the push services). All three, or the transport stays off. Secrets live in
   `box.local.json`. **The pair is durable**: rotating it invalidates every stored subscription and every
   browser has to re-enable the toggle.
2. **Device push** is the same shape, one credential: `push.*.FCM_SERVICE_ACCOUNT`, the Firebase
   service-account document (Project settings -> Service accounts -> Generate new private key)
   pasted as a single JSON **string** with the `private_key` newlines escaped as `\n`. Skip it
   unless this team runs `apps/mobile`. APNs is configured in the Firebase console, not here.
3. **Decide which alerts route to which room.** Settings -> Rules, the `route` field on an alert
   rule. `chat:<slug>` is the vocabulary this feature adds - `chat:standup`, `chat:go-to-market`.
   The room must already exist (delivery throws otherwise, and the alert row records the error
   rather than disappearing), the slug must be a plain room - `chat:dm:...` is refused on purpose -
   and everything else (`owner`, `user:<id>`, `channel`) keeps going to alerts' Lark routing
   untouched. The rule dialog's placeholder does not mention `chat:` yet; it still works.
   Rule of thumb from the code's own comment: page a person for what needs answering now, route to
   a room what wants a durable line people read later.
4. **The copy and the badge**, if the team disagrees with them.
   `features/notifications/server/notifications/notification-copy.ts` is two pure
   functions shared by both transports - change it there or phone and browser drift. The badge
   counts mentions + alerts and deliberately not unread messages; the bell's topbar `order` is
   `200` in `features/notifications/web/index.tsx`.

There is no vocabulary, no table and no migration to seed.

## 3. Prove it

```bash
box dev
```

Open `http://localhost:8190/` (Nest is the single origin; if another Box is already running, move
this one with `server.port` / `server.vitePort` rather than sharing a default -
`apps/server/src/agent/loopback-guard.ts`). Signed in, the **bell** sits in the top bar. You
should see:

- a dropdown with "Nothing new." on a fresh Box, and a **Clear all** header once there are rows;
- three strata once there is traffic - `@` mention, message, alert - newest first, with unseen rows
  tinted, a per-row dismiss `X`, and a count pill (capped at `9+`) that clears the moment you open
  the dropdown;
- a **"Push mentions to this browser"** footer row *only* if VAPID is configured. No VAPID means
  `notificationsPushConfig` answers `enabled:false` and the footer does not render at all - that is
  correct, not a failure.

End to end, four checks that exercise the whole feature:

1. **Bell, chat half** - from a second session (or `bun run cli chat-post`), post `@you something`
   into a room you are in. The badge increments without a reload: the bell rides the shared chat
   frame feed.
2. **Bell, alerts half** - any alert row landing in the warehouse shows up as a `Siren` item; the
   `table:alerts` change invalidation refreshes the bell.
3. **The glue, the other direction** - create an alert rule routed `chat:<an existing room>`, let
   a matching alert fire and be delivered, and the rendered message appears in that room as a post
   from the agent (`nova`), with no mentions in it. A burst arrives as one post with a bulleted
   line per alert, not one post each.
4. **Push**, if configured - flip the footer toggle to **On** (the browser prompts; permission
   must come from that click), then trigger a mention from another session while this tab is
   *not* focused on that room. A desktop notification appears with the sender's rounded avatar;
   clicking it focuses the tab and routes to `/chat/<slug>` with no page reload; "Mark read"
   clears the bell row without opening anything. A push for the room you are already looking at is
   swallowed by design.

`GET http://localhost:8190/api/push/sw.js` should return the worker source unauthenticated - if it
bounces off auth, push can never register.

No MCP tools: the bell is a human surface, and an agent already reads chat and alerts through their
own tools.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
