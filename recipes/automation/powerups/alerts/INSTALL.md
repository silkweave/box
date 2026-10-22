# Alerts powerup: install

Adds delivery to Automation: the `do_kind = deliver` runner, the `alerts` ledger, the debounced
flusher, the transport port, the daily digest and the Alerts tab. Read [POWERUP.md](POWERUP.md) and
the automation [GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for
the owner decisions.

## Detect

`features/automation/core/alerts/` exists and `features/automation/server/automation/automation.module.ts`
imports `AlertsModule`. On a running Box, `box alerts-list` answers (an empty list is fine),
`box triggers-list` reports `deliver.available: true`, and Settings > Automation shows an Alerts
tab. `box triggers-list` with `deliver.available: false` means the powerup is absent; source present
with `deliver.available: false` means the wiring below is incomplete.

## Requires

- The Automation recipe, adapted and validated.
- For delivery into chat: the [Notifications](../../../notifications/RECIPE.md) recipe (and Chat),
  which registers the `chat` and `dm` transports. The powerup installs and verifies without it, but
  every route then records `error: no alert transport handles route "..."`.

## Owner decisions

1. **The alerts room.** Where `channel` and an unresolved `owner` deliver: a chat room slug in
   `features.automation.alerts.channelRoom`, default `automations`. The room must exist in chat.
2. **First deliver triggers.** Which events should page whom, for example `run.error` into the
   alerts room, `signal.threshold` to the signal's owner, `reddit.inbox` or `github.notification` to
   a person, and whether a daily digest (`alerts-digest` plus a trigger on `digest.daily`) is wanted.

## Owner-only steps

None. Creating the room and the triggers is done by the agent with the owner's choices.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy these directories from `<fetched stack>` into
   the Box, merging with any local copy:
   - `features/automation/core/alerts/`
   - `features/automation/server/alerts/`
   - `features/automation/web/alerts/`
2. **Wire them into the base recipe.**
   - `features/automation/core/manifest.ts`: import `ALERTS_ACTIONS` from `./alerts/actions.js` and
     `ALERTS_MODELS` from `./alerts/models.js`, set `models: [...AUTOMATION_MODELS, ...ALERTS_MODELS]`
     and `actions: ALERTS_ACTIONS`.
   - `features/automation/core/index.ts`: `export * from './alerts/index.js'`.
   - `features/automation/server/automation/automation.module.ts`: import `AlertsModule` from
     `../alerts/alerts.module.js` and add `imports: [AlertsModule]` to the module.
   - `features/automation/web/views/AutomationView.tsx`: import `AlertsSection` from
     `../alerts/AlertsSection.tsx`, add `{ value: 'alerts', label: 'Alerts' }` to `SECTIONS` and the
     `section === 'alerts' ? <AlertsSection />` render branch.
   The `alerts` table is created from the model; there is no migration.
3. **Configure** the alerts room when it is not `automations`: `features.automation.alerts.channelRoom`
   in `box.json`. Create the room in chat (`box chat-room-create`) if it does not exist.
4. **Transports.** For chat delivery adapt the Notifications recipe if the Box does not have it
   (`recipes/notifications/INSTALL.md`); its server module registers the `chat` and `dm` transports.
5. **Triggers.** Create the owner's deliver triggers with `box trigger-upsert` (`when_kind: "event"`,
   `do_kind: "deliver"`, `route`, `message`, optional `filters`, `notify`, `cooldown_min`,
   `debounce_sec`) or in Settings > Automation > Triggers. For the digest, add a time trigger on
   `alerts-digest` (daily, morning) and a deliver trigger on `digest.daily` with route
   `{{fields.route}}`.
6. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`.

## Verify

1. Boot (`box dev`) and run `box triggers-list`: `deliver.available` is `true`, and Settings >
   Automation > Triggers offers "Deliver a message" on an event trigger without the powerup note.
2. End to end with a sample event: create a deliver trigger to the alerts room (for example on
   `run.error`, route `channel`), then `box trigger-run` it with a sample `event` (or Run now in the
   editor). The reply is `delivered to chat:<room>`, and the message appears in that room. `delivery
   to ... failed: no alert transport handles route` means the path works and the Notifications
   transports are missing.
3. The live path, with `background.automation` true: run an action that fails (`box run-now
   --action_id <id>` for an action whose credential is missing, or any action that errors). The funnel records `run.error`, the trigger records a `pending` row (`box alerts-list`),
   and it turns `delivered` when the debounce (default 300s) lands.
4. Open Settings > Automation > Alerts in a browser: the history lists the alerts with a status
   badge per row.
5. Run `box verify`.
6. After these checks pass, record the powerup: add `alerts` to `recipes.automation.powerups` in
   `box.json`.

## Remove

1. Delete or disable the deliver triggers first (`box trigger-delete`); afterwards they would be
   listed invalid.
2. Remove the wiring lines from step 2, then the three `alerts/` directories. Notifications needs
   the powerup (its transports import the port), so remove or adapt it first.
3. Remove `features.automation.alerts` from `box.json` and `alerts` from
   `recipes.automation.powerups`. The `alerts` table stays in the warehouse, unread.
4. Run `box verify` and load Settings > Automation: the Triggers tab shows the Alerts powerup note.
