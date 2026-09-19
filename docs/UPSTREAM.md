# Source record

Core source: [silkweave/stack](https://github.com/silkweave/stack), commit
`05f6435d36e1e4f960ab6c05746813d6c1bdec9d`, integrated on 2026-09-19.

This Box includes the core server, web app, CLI, provider utilities, UI library and five core skills.
No reference features are integrated. Feature registration and exports are intentionally empty.
The root dependencies, lockfile, configuration and consumer guides are tailored to this scope.
Background automation is disabled by default. Source paths retain their Stack layout.

Record the actual Stack commit and intentional local changes for each future core refresh or
feature integration. Validate before advancing the recorded baseline.

## CLI implementation working snapshot, 2026-09-19

Integrated `packages/cli/src/{ui,tasks,task-view,verify}.ts`, CLI verification tests, and `docs/CLI.md`
from the Stack working tree based on `05f6435d36e1e4f960ab6c05746813d6c1bdec9d`. These additions
are not yet contained in a Stack commit. Paths are unchanged. The consumer manifest changes only
its verify script; dependencies, lockfile, feature registration and other scripts are preserved.
The previous completed core SHA above remains the baseline; this is a scoped working-snapshot
record, not a completed core upgrade. See INTEGRATION.md for backup and validation.

CLI snapshot finalized in Stack commit `f368209804c3907e19f7cc7b09f1f0ade5e76aff` on 2026-09-19.
The copied CLI implementation and tests match that commit; the earlier core baseline remains
unchanged because this was a scoped CLI update, not a complete core refresh.

## Bun runtime integration, 2026-09-19

Source: Stack base `48146e2d5143d47053db9443147e9d46506e3a12` plus its uncommitted Bun
migration. This is a selective integration, not an advancement of the previous completed
full-core baseline. Adopted CLI/shim, branding HTML hook, runtime entry points, workspace/lockfile
policy, CI, command guidance and setup skills; retained consumer package ownership and empty
feature registration. Consumer validation passed with Bun 1.4.2. See INTEGRATION.md and
VALIDATION.md for backup, rollback and exact evidence.

Bun migration source finalized in Stack commit `2291e2d1562b81b4a2f433469fc47d4f61d9f5b9`. The consumer retains
its previous full-core baseline; this commit identifies the scoped runtime/CLI integration.
