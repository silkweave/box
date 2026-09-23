---
name: verify
description: Validate a Silkweave Box after source integration or upgrade, including runtime checks that static tests cannot see.
---

# Verify a Box

Read `docs/UPSTREAM.md`, `docs/INTEGRATION.md`, and `docs/GOTCHAS.md` first. Establish the source
revision, local changes, migration state, backup location, and unresolved work. Do not call a
partial check a verified Box.

Establish which recipes are adapted: a recipe is adapted when its id is registered as a feature.
Check each adapted feature against its `recipes/<id>/SPEC.md` and `GOTCHAS.md`, and confirm that the
revision recorded for it in `docs/UPSTREAM.md` is the one whose implementation was read.

Run the Box chain: build, typecheck, lint, meaningful tests, and `schema:check`. Include CLI tests
and generated type work where the workspace provides them. Inspect server production output and web
output, then boot a disposable Box and check sign-in and the browser console. Keep background
integrations disabled unless the requested verification explicitly covers their live behaviour.
The web registry has an import cycle, so a module-scope registry read can white-screen a browser
after static checks pass.

For the live Builder Preview, activate verified backend, registration, configuration, and migration
changes with `box app restart` before the runtime check. `box dev` is the stable supervisor that
owns the Builder agent, so never stop, kill, replace, or relaunch it and never start a second Box
against the same instance. `box app restart` restarts only the editable application and waits for
health. If it cannot reach the supervisor, stop and ask the host operator to restore it.

For migration work, query the actual ledger and schema, compare them with the integration record,
and verify the backup can be restored. If a progress note lags database state, trust the database
and record the discrepancy. A checksum refusal is a data safety stop, not a lint failure.

Record commands, revision, date, results, limitations, and remaining pins in `docs/VALIDATION.md`.
Only mark the run complete after the full chain and runtime checks pass. Keep failed or pending
results explicit.
