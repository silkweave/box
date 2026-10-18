# Validation

Run `box verify` from the intended checkout. The complete chain builds the workspace, checks
skill links, runs CLI and web tests (`apps/web/tests` and `features/*/web`), generates API types, typechecks, lints, runs core and server tests,
checks the schema matrix, and runs the mobile check (Flutter analyze and test for the framework,
the app and each `features/<id>/mobile` module; reported as skipped when Flutter is not installed,
see [MOBILE.md](MOBILE.md)). A skipped mobile check is not a mobile pass: record it as skipped.
`box verify --plain` provides append-only output; `--verbose`
includes full child output. A failed check does not stop independent checks, and core and server
tests replay cached results when their inputs are unchanged; `box verify --force` re-executes
everything. See [CLI.md](CLI.md) for progress, dependencies, caching, warnings and log locations.

Use focused checks during development, then run the complete chain before calling work complete.
A passing exit status with warning output is not a warning-free run. Record the actual revision,
commands, counts, warnings, failures and untested scope in local `_docs/VALIDATION.md`.
Dependency freshness requires its own dated update/check result; a passing locked build alone
does not establish that dependencies are current.

## Runtime checks

Load changed routes in Shuttle (the `shuttle` MCP server). Typechecking cannot detect every module-scope
registration cycle. Use an independent scratch checkout with its own data, configuration and
free ports. Keep automation, chat agents and relay disabled unless the test explicitly needs them.
Do not point two servers at one instance or copy live credentials into logs.

Exercise authentication and representative changed routes in development and production modes.
For runner changes, test streaming, approvals, interruption, reconnect, recovery and shutdown
as appropriate. Distinguish scripted test peers from authenticated provider turns, and idle
recovery from preservation of an active turn. Stop temporary servers after testing.

## Schema and migration checks

`schema:check` exercises fresh/repeated boot and enabled-later feature paths. A migration change
also requires a rehearsal against a restored backup of every affected store. Preserve shipped
migration identities and bodies. Record rehearsal evidence and rollback details locally; keep
lasting operating requirements in [WAREHOUSE.md](WAREHOUSE.md) and [GOTCHAS.md](GOTCHAS.md).
