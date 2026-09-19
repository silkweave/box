# Features

Silkstack features are reference source maintained in this repository. The source layout is
`features/<id>/{core,server,web}` with documentation alongside it. The stack carries all maintained
features; a consumer Box starts with core and integrates only what its team chooses.

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
notifications, engagement, and reminders. A consumer may have only a subset.


## Updating and resuming

Use `$adapt` for one feature, `$upgrade` for core, and `$verify` for the whole Box. Compare the
recorded previous upstream commit, local code and target upstream commit. Keep full commit SHAs and
path mappings in `docs/UPSTREAM.md`; a date or release label alone does not identify the ancestor.
Write current scope, completed results and rollback instructions in `_docs/INTEGRATION.md`; keep
durable source ancestry and path decisions in `docs/UPSTREAM.md`. On resume,
inspect actual files and migration ledgers before replaying a step. Advance completed SHAs only
after verification, and record deliberately skipped upstream changes.

Existing consumers that used the retired adoption command keep their source and data. Recover the
reference ancestor from their adoption records and historical tags where possible. There is no
bulk reinstall, forced replacement of customized files, or renaming of historical migrations.
Historical tags remain available for ancestry; the stack no longer creates feature release tags.
