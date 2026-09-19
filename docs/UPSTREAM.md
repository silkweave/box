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
