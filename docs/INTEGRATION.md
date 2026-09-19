# Integration record

This guide defines the durable safety rules for adapting Stack source into this Box. Record the
active scope, commands, backups, migration identities, results and rollback steps in the gitignored
`_docs/INTEGRATION.md`. Keep source ancestry and completed path decisions in `docs/UPSTREAM.md`.

## Current Box scope

This checkout is a core-only consumer. No reference feature is integrated. Configuration uses root
`box.json` plus the gitignored `box.local.json`; runtime state is under `data/`.

## Integration procedure

Before changing source, compare the recorded upstream SHA with the actual consumer tree and target
source. Preserve local changes and keep the previous completed baseline until validation passes.
Record the intended scope and a recoverable backup in `_docs/INTEGRATION.md`.

For a feature or core refresh:

1. Read the source feature documentation, local gotchas and the relevant runtime contracts.
2. Copy and adapt only the required source paths, package dependencies and maintained registrations.
3. Before changing a warehouse, back up every affected store and record the restore command.
4. Stage migration code with the minimum runner and registration, preserving names and bodies
   byte-for-byte. Confirm migration completion and boot before unrelated changes.
5. Run the complete validation chain and exercise changed routes in an independent checkout with
   background work disabled.
6. Record unresolved compatibility limits and a rollback command. Advance `docs/UPSTREAM.md` only
   after the integration is complete and validated.

New behavior requires a new migration. Warehouse migration ledgers check digests; chat's private
ledger is keyed by migration object name. A source-only rollback must preserve credentials,
`box.local.json` and instance data. If migrations require a data restore, use the recorded backup
and a separately rehearsed restore procedure.
