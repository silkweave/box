# Validation

Run validation from the Box checkout with Bun. Runtime rehearsals use independent checkouts with
background automation, chat agents, relay and WorkerDeck disabled unless explicitly under test.

```sh
bun install --frozen-lockfile
box verify
```

The complete chain covers build, skill linking, CLI tests, generated types, typecheck, lint, core
tests, server tests and the schema matrix. Use `box verify --plain` for a transcript suitable for
automation and `--verbose` when child output is needed.

For changes that affect boot, routes, authentication, branding, configuration or the agent host,
use an independent checkout with its own ports and fresh `data/`. Start the development and
production servers as applicable, then exercise the changed surface in Chrome DevTools. Confirm
the browser console, server logs, authentication boundary and disabled-feature behavior.

For migrations, back up every affected store first, rehearse restore, inspect the migration ledger,
and confirm boot before continuing. Preserve migration names and bodies byte-for-byte.

Keep the commands, source state, dependency state, results, warnings, backups and limitations for
the current run in the gitignored `_docs/VALIDATION.md`. Keep integration steps and rollback notes
for the current run in `_docs/INTEGRATION.md`; committed `docs/` records only the reusable procedure
and durable product invariants.
