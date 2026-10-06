# Adapting the `alerts` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/alerts/`; the reference implementation lives in the Stack at `features/alerts/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** automation, data, planning, content, engagement. Adapt those recipes first; their features must already be registered in the target Box. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/alerts/` into the Box's `features/alerts/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

One shipped migration: `alerts:001-import-rules` (2026-10-06) imports `features.alerts.rules` into automation's `triggers` table as deliver triggers (SPEC.md, "Migration"). Back up the warehouse and the config files first, stage the runner and registration, and rehearse on a disposable restored instance: compare `triggers-list` with the old rule set (ids, routes, messages, enabled, signal filters) and confirm boot. Then remove `features.alerts.rules`, `features.alerts.routing` and `features.alerts.larkCli` from the config files. A `signal.threshold` event's dedup key now carries the threshold, so a crossing that is still the latest pair can deliver once more after the upgrade.

## 2. Customise for the team

1. **The deliver triggers are the main thing.** Everything else is plumbing. Create them in
   Settings > Automation > Triggers (When: a Box event, Do: deliver a message) or with
   `trigger-upsert`:

   ```json
   { "id": "run-failures", "name": "Run failures", "when_kind": "event", "event_kind": "run.error",
     "do_kind": "deliver", "route": "channel", "cooldown_min": 30,
     "message": "{action_id} failed: {error}" }
   ```

   `{token}`s are filled from the event's flat `fields` (and `{{fields.name}}` / `{{actor}}`);
   unknown tokens are left intact, which is how you discover the real field names. Routes:
   `user:<id>` (a direct message from the agent), `chat:<room-slug>`, `channel` (the alerts room),
   `owner` (a signal's owner on a signal event, else the alerts room). Filters narrow the kind
   (`fields.repo = silkweave/box`). `notify: digest` sends nothing per event; the daily digest counts
   it where its route points, and a trigger on `digest.daily` with route `{{fields.route}}` sends
   the recap. A trigger on `signal.increase` / `signal.threshold` names its signal with the filter
   `fields.signal_id` and its threshold with `fields.threshold`.

2. **The alerts room.** `box.json features.alerts.channelRoom` (default `automations`) is where
   `channel` and an unresolved `owner` land; create that room in chat. Delivery needs
   `notifications` installed: it registers the `chat` and `dm` transports. A route nothing claims
   records a delivery `error`.

3. **Which evaluators run.** Trigger the `alerts-*` actions on a time through `automation` (fast
   tier for `alerts-reddit` / `alerts-github`, ~15 min for `alerts-traction`, daily for
   `alerts-digest`). `alerts-github` needs a `github` account with a `GH_TOKEN` credential;
   `alerts-linkedin` needs published LinkedIn pieces and, for member posts, the author's Chrome in
   `box.json features.data.browsers`. An evaluator nobody listens to short-circuits, so an unused
   one costs nothing. `features.alerts.tractionTiers` sets the traction ladder.

4. **The vocabularies.** `traction.ts` `ENGAGEMENT_KINDS` / `DEFAULT_TIERS` / the 60-minute window,
   `digest.ts` `KIND_LINE`, `flush.ts` `DEFAULT_DEBOUNCE_SEC`. These nouns are inherited from the
   predecessor; change them to the team's.

5. **Labels and order.** The settings section `Alerts` at 810 in `features/alerts/web/index.tsx`.

## 3. Prove it

```bash
box dev
```

Open Settings > Alerts: the history renders (empty is fine) with a status badge per row. Settings >
Automation > Triggers offers "Deliver a message" on an event trigger; save one and it is listed
with its route.

Agent-side: `box triggers-list`, `box trigger-upsert`, `box trigger-run`, `box alerts-list`.

To fire a test alert without waiting for anything real, use Run now on the deliver trigger (the
play button): it asks for a sample event and delivers it at once, answering `delivered to
chat:automations`, `suppressed: ...` or `delivery to ... failed: ...`. The live path: with
`background.automation` true and a trigger on `run.error`, run an action that will fail (an
`alerts-github` with no credential configured will do). The funnel records the failure,
`onRunOutcome` records a `run.error` event, the trigger records a `pending` row, and the history
shows it within its 10s poll; it flips to `delivered`, `suppressed` or `error` when the debounced
flush (default 300s) lands. `error` with `no alert transport handles route` means the whole path
worked and the route is wrong or `notifications` is missing.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
