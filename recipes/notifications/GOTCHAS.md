# notifications gotchas

Push credentials and subscriptions are local data. Preserve them, and remember notifications depends on both chat and alerts at runtime.

The feature id (`notifications`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- **Boot order is `onModuleInit`, and `registerAlertTransport` throws on a duplicate `id`.** It is
  not idempotent, unlike the delivery seam's `registerNotificationTransport`, which replaces by
  name. If you add a second registration path, you will find this the hard way.
- **Push keys are credentials, not environment variables.** Configure `push.*.VAPID_*` under
  `credentials` in `box.local.json`; no `PUSH_VAPID_*` environment variable is read.
- **All three VAPID credentials or none.** A pair without `VAPID_SUBJECT` reads as unconfigured and
  push is silently off.
- **A malformed `FCM_SERVICE_ACCOUNT` warns and turns device push off**, it does not throw. Read
  the server log; a mis-escaped `private_key` looks exactly like never having configured it.
- **Never add a field to `NotificationDelivery` that could carry a URL or a filename.** The preview
  is 120 chars of `message.body` and nothing else, on purpose: a pushed payload renders on lock
  screens far outside the tailnet and outlives the notification. Attachments have no field here.
- **Do not `ATTACH` chat.db from the warehouse** to "just join" the bell's two strata. Both reads
  are capped at 30 rows and merged in memory precisely so the interactive bell never sits behind
  DuckDB's single-writer lock.
- **Marking the bell seen must never write `room_members.last_read_at`.** Two pointers, two
  questions; wiring them together makes the sidebar badge lie.
- **Alert read-state uses `alertSeenKey`, not `event_at`.** A future-dated `event_at` against a
  `Date.now()` watermark is permanently unseen and permanently un-clearable, and the bell's
  mark-on-open then loops against the reload - it did, unattended, on 2026-09-10. The `stuck` guard
  in `NotificationBell` is the second half of that fix; do not remove either.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it - `box verify` has no
  runtime step (`AGENTS.md`).
- **The service worker is a string in `push-sw.ts`, not an asset.** The server build does not copy
  assets and in dev every non-reserved route is proxied to Vite, so a reserved `/api` route is the
  only path served identically in both topologies. The `Service-Worker-Allowed: /` header is what
  permits scope `/`; drop it and registration fails.
- **A stale `packages/core/build/`** fails the server tests with a confusing resolution error after
  any rename here. `box build` fixes it (`AGENTS.md`).
