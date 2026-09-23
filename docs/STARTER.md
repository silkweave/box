# Core-only starter checklist

Produce a core-only consumer checkout from a recorded Stack commit using this checklist.
Recipe adaptation is agent-driven; record the actual source revision used.

## Prepare the source

1. Record the source repository, source working-tree state or clean SHA, candidate base, and date in
   `docs/UPSTREAM.md`. A dirty source tree must be named as dirty; never invent a completed SHA.
2. Preserve existing team edits. Make a recoverable copy of the consumer checkout and all instance
   data before changing source.
3. Select only the core runtime and its required workspace packages. Keep `packages/core`,
   `packages/ui`, `packages/provider-kit`, `apps/server`, `apps/web`, `packages/cli`, workspace
   configuration, core docs, public assets, and their actual package manifests.
   Copy `recipes/` whole: every recipe's documentation and screenshots ship with core, so the
   onboarding recipe catalog and adapting agents can read them in the Box.
4. Exclude every reference implementation folder under `features/`, the stack's independent `box/`
   directory, development `data/`, node_modules, build and dist output, Turbo state, and `.git`.
   Retain an empty `features/` directory with `.gitkeep` because the server build command names that
   directory and a fresh checkout cannot preserve an otherwise empty directory.
5. Keep the root package named `silkweave-box`. Remove root dependencies whose only consumers are
   omitted feature imports. Confirm each remaining dependency against source imports and the actual
   package manifests for core, server, web, UI, provider-kit, and CLI. Do not add a feature manifest
   or a generated dependency list.
6. Keep the normal package manifests for actual workspace packages and regenerate one root lockfile
   after the dependency decision. Install from the global store when available, then inspect the
   lockfile and peer warnings.

## Maintain the core shell

7. Keep the core, server, and web registration files as maintained source. In a blank starter,
   `FEATURES`, `SERVER_FEATURES`, `WEB_FEATURES`, and `WEB_ROUTES` are empty arrays and their public
   list exports remain present. `packages/core/src/generated/exports.ts` remains an explicit empty
   export surface. Core's own warehouse, auth, users, events, ops, and agent-host runtime remains
   registered through its ordinary modules.
8. Confirm `apps/web/src/router.tsx`, navigation, settings, shell slots, and session startup still
   work with empty feature lists. A featureless Box should show the core shell and settings fallback,
   not a stale feature route.
9. Confirm the server production build accepts an empty `features/` directory on a fresh checkout.
   Keep the minimal `.gitkeep` if the command still names the directory. Do not add a source
   generator merely to manufacture an empty directory.

## Verify before first use

10. Run `bun install`, then `box verify`. The chain must include build, CLI tests, type generation,
    typecheck, lint, core tests, server tests, and `schema:check`.
11. Record the actual command, source state, dependency update date, test counts, warnings, and any
    limitations in `_docs/VALIDATION.md`. A passing lockfile build does not prove latest dependency
    freshness unless the update date and command are recorded.
12. Configure identity, brand and ports in `box.json`, then run `bun setup`. Confirm the system
    principal, create the first owner, and select any detected Codex or Claude profiles. Setup keeps
    the owner token and generated secrets in gitignored mode-0600 `box.local.json`. Never commit
    credentials. Keep background automation, chat agents and relay off for the first boot. Keep
    `stack.source` in `box.json` pointing at the shared Stack; put a local checkout path in
    `box.local.json` only on machines that have one.
13. Start the source server and production server against disposable fresh data. When setup found
    no provider, confirm the log says the agent surface is off. Check `/`, `/api/auth/instance`,
    `/settings`, and the feature paths that must remain absent. Confirm the browser shell, sign-in
    entry point, and disabled-agent path.

## Adapt a recipe

14. Read the recipe's `recipes/<id>/INSTALL.md` and `GOTCHAS.md`, the Box's `docs/GOTCHAS.md`, and
    the reference implementation and migrations from `box stack fetch --ref <sha>` before copying
    anything. Identify the feature's imports and install the latest packages those imports require
    in the Box workspace.
15. Copy and adapt the implementation's `core`, `server`, `web` and `skills` source into the Box's
    `features/<id>/`. Rewrite imports, paths, routes, styles, and package boundaries for the actual
    Box. Update core exports and all maintained registration files by hand.
16. Stage migration code and the minimum runner and registration required to execute it. Before
    applying a migration, take a named backup and record its path and restore command in
    `_docs/INTEGRATION.md`. Apply migrations first, confirm completion and boot, then continue with
    unrelated feature changes.
17. Preserve migration identities, evaluated statements, callback bodies, and order byte-for-byte.
    A checksum mismatch against live data is a refusal to boot. Restore the backup or record an
    explicit historical reconciliation. New behavior gets a new migration.
18. Run the full validation chain again, then boot against disposable data and test the feature's
    route, server surface, schema, migrations, and disabled-agent behavior. Record adapted files,
    backup locations, unresolved work, and rollback instructions in `_docs/INTEGRATION.md`.
    Promote durable operating guidance to the Box's product docs.
