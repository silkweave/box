# Silkweave Box working rules

This checkout is a core-only Silkweave Box consumer. Read `docs/FEATURES.md`,
`docs/CONFIGURATION.md` and `docs/VALIDATION.md` before integration or runtime work.

## Layout and ownership

Runtime source lives under `apps/` and `packages/`. Optional reference source is integrated into
`features/<id>/{core,server,web}` from the upstream Stack. Feature documentation stays beside the
integrated source. Keep normal manifests for actual workspace packages and one root lockfile; do
not add feature package or dependency manifests.

Feature registration is maintained source. Update `src/generated/features.ts` and
`packages/core/src/generated/exports.ts` deliberately when a feature is integrated. They remain
empty in a core-only Box and are tracked even though their names contain `generated`.

## Runtime rules

Use the installed `box` shim as the public CLI entry point. Bun is the runtime and package manager;
use `box dev` and `box verify`. After changing the standalone Builder shell, use
`box builder refresh` to update its snapshot without restarting the shared session. When Builder
supplies a session id, use
`box builder browser --session <session-id> <operation> [JSON object]` for Preview control.

Feature installation is agent-driven: read the upstream feature source and documentation, adapt
imports and wiring, update registration, install the packages its imports need, then prove the
result with the complete validation chain. There is no `box adopt`, registry catalogue, tag
publishing protocol, compose or mount workflow, overlay guard, `box-lock.yaml`, or feature
dependency manifest.

Migrations are the hard boundary. Preserve shipped identities and bodies byte-for-byte. Back up
every affected store first, stage migrations with the minimum runner and registration
prerequisites, apply them before unrelated changes, then rehearse restore and boot compatibility.
New behaviour gets a new migration.

## Validation

Run `box verify` for build, skill linking, CLI and web tests, generated type work, typecheck, lint,
core tests, server tests and `schema:check`. Run focused checks while developing, but do not call
work complete until the full chain and browser runtime checks pass. Record the actual result in
`_docs/VALIDATION.md`.

Before a core refresh or feature integration, record source SHAs, scope, local changes, backup and
rollback state in `_docs/INTEGRATION.md`. Keep the previous completed core SHA until validation
passes. Record completed ancestry in `docs/UPSTREAM.md` and durable warnings in
`docs/GOTCHAS.md`.

## Working style

Keep plans, spikes, screenshots, session status, run results and temporary workarounds in ignored
`_docs/`. Remove them when the work ends. Committed `docs/` contains supported behavior,
architecture and reusable operating procedures. Do not invent SHAs, test results, releases or
field evidence. Never use em dashes. Use dates in `YYYY-MM-DD` form.

## Instance safety

A Box is this checkout plus its `data/`; there is no `BOX_DATA_DIR` override. Use an independent
scratch checkout for runtime rehearsals and never point two servers at one instance. Keep
automation, chat agents and relay disabled unless the test explicitly covers them. Put shared
settings in `box.json` and local ports, credentials and secrets in ignored `box.local.json`.

Choose the system principal before first boot. Preserve configured identities and credentials.
Use `box auth token <id> --quiet` when creating a test human and `box auth login <id>` for a
short-lived sign-in link; never print permanent tokens into a transcript. Read `docs/AUTH.md` and
`docs/WAREHOUSE.md` before changing those invariants.

The UI library owns reusable presentation, not domain vocabulary, feature imports or storage keys.
Use lazy registration reads and core-owned ports for cross-feature integration. Use Chrome
DevTools MCP for browser testing.

## Wrapup Config

- check: `box verify`
- test: included in verify
- frontend_smoke: Chrome DevTools MCP against an independent checkout, background work disabled
- docs: durable product guides in docs/ and beside features; transient developer records in _docs/
- push: yes, when the user requests publication
- version_bump: no
- publish: no
- changelog: no
- co_authored_by: no
