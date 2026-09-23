# Features

Silkstack features are reference source maintained in the upstream Stack. Their source layout is
`features/<id>/{core,server,web}` with documentation alongside it. This Box starts with core and
integrates only what its team chooses; an integrated feature becomes ordinary source in this
repository.

A feature describes its domain code, server controllers, web routes, imported packages, migrations,
setup decisions, and gotchas. Its imports plus prose are its dependency description. There is no
`app.json`, `deps.json`, feature package manifest, registry catalogue, release tag, or `box adopt`.
The root workspace package owns packages imported by the shared feature tree.

An agent reads the feature source, `docs/GOTCHAS.md`, and the Box's local gotchas, then copies and
adapts the relevant core, server, and web code, adds required packages, updates
`src/generated/features.ts` and `packages/core/src/generated/exports.ts`, and runs build,
typecheck, lint, tests, and `schema:check`. Build and type errors during integration are part of
the work. Record durable local findings in the Box's `docs/GOTCHAS.md`.

Migrations are the carve-out. Preserve existing names and bodies byte-for-byte. Back up before
applying, stage the minimum runner and registration, apply migrations before unrelated changes, and
confirm boot. New behaviour requires a new migration. The warehouse ledger checks its digest;
chat's current ledger does not.

The maintained source includes planning, CRM, chat, sink, content, data, automation, alerts,
notifications, engagement, reminders, and the web-only Artifacts placeholder. A consumer may have
only a subset.

[Builder](BUILDER.md) is a core administrator workspace, not an optional reference feature.


## Updating and resuming

Use `$adapt` for one feature, `$upgrade` for core, and `$verify` for the whole Box. Compare the
recorded previous upstream commit, local code and target upstream commit. Keep full commit SHAs and
path mappings in `docs/UPSTREAM.md`; a date or release label alone does not identify the ancestor.
Write the intended steps and completed results as work proceeds in `_docs/INTEGRATION.md`. On resume,
inspect actual files and migration ledgers before replaying a step. Advance completed SHAs only
after verification, and record deliberately skipped upstream changes.

When a consumer lacks a recorded source SHA, recover the closest ancestor from its repository
history before integrating. Never bulk-replace customized files or rename shipped migrations.
