# Recipes

A recipe is something the Stack offers and a Box can adapt: a team-facing capability such as
Planning, CRM or Chat. Each recipe has two halves that live in different places.

- **Recipe documents** at `recipes/<id>/`: `RECIPE.md` (the catalog entry), `SPEC.md` (the runtime
  contract and behavior), `INSTALL.md` (the adaptation procedure), `AGENT.md` (the adaptation and
  customisation guide), `GOTCHAS.md` (recipe-specific hazards), `screenshots/` and `powerups/`.
  `recipes/` is a managed core path, so every Box carries the documents for every recipe, adapted
  or not.
- **Reference implementation** at `features/<id>/{core,server,web}` in the Stack, plus
  `features/<id>/skills/` when the recipe ships agent skills and the parts its powerups add, such as
  `features/<id>/mobile/` for the mobile app ([MOBILE.md](MOBILE.md)). The implementation stays in
  the Stack; a core-only Box does not contain it.

Adapting a recipe puts its code into the Box's `features/<id>/` and registers it there. From that
point it is a feature of that Box: runtime registration (`WEB_FEATURE_LIST`,
`src/generated/features.ts`, `packages/core/src/generated/exports.ts`), the `features.<id>` settings
in `box.json`, warehouse migration keys `<feature>:<name>` and the feature manifests all keep the
word "feature". The recipe id and the feature id are the same string, except for the Mobile app
recipe, whose code ships with core: it has no feature id and nothing to register.

See [`recipes/README.md`](../recipes/README.md) for the folder layout and the `RECIPE.md` and
`POWERUP.md` formats.

## Powerups

A recipe adopts a feature in its base form: the smallest complete version a team can use the same
day. Optional capabilities that build on it are **powerups**, added when the recipe is adapted or any
time later, one at a time. The mobile module of chat, planning, notifications and artifacts is a
powerup; so is public hosting for artifacts on Cloudflare.

The rules that make this hold:

- **The base recipe is complete.** A powerup never changes what the recipe does when it is absent.
  Leaving one out, or removing it, leaves a working feature.
- **Absence is visible and actionable.** Where a missing powerup's capability would appear, the
  feature says it is not set up, names the powerup, and offers administrators a Builder brief to add
  it. Members are told to ask an administrator. A raw configuration error is not guidance.
- **Adapted state is recorded, and checked.** The `recipes` ledger in `box.json` records what the
  Box adapted and verified. The powerup's `## Detect` section and the feature's own status check
  confirm the actual state before anything is recorded or acted on.
- **The owner's part is explicit.** Outside accounts, sign-ins and keys are owner-only steps, asked
  for at the point they are needed. The agent does everything else, generates shared secrets itself,
  keeps them in `box.local.json` and never prints them.
- **Done means verified.** Every powerup ends with checks that prove the capability end to end,
  and features expose a status check when the capability depends on something outside the Box.
- **One folder, one unit.** A powerup's documents live in `recipes/<id>/powerups/<powerup>/`, its
  source beside the recipe's under `features/<id>/`, and it is discovered from the folder, so adding
  one never edits the recipe. It can be reviewed, added and removed on its own.

A powerup can require other things first. Its `POWERUP.md` may carry a `## Requires` section of links
to recipes or to powerups of the same or another recipe, for example the Mobile app recipe. The
powerup's own recipe is always required and is not listed. The gallery locks a powerup until its
recipe is adapted and every requirement is met.

Powerups are offered on the Recipe Gallery's recipe cards and detail dialog ("Add", once the recipe
is adapted and the requirements are met), asked about by the adapt brief, and offered by the feature
itself where the capability is missing. Each path only drafts a Builder brief; the owner reviews and
sends it.

## The recipe ledger

`recipes` in the root `box.json` lists each adapted recipe by id with the powerups added to it:

```json
"recipes": {
  "chat": { "powerups": ["mobile"] },
  "mobile": { "powerups": [] }
}
```

The agent that adapts a recipe adds its entry once the validation chain passes. The agent that adds a
powerup appends its id to `recipes.<recipe>.powerups` once the powerup's Verify steps and the
validation chain pass. Removing a recipe or a powerup removes the entry or id. The ledger stays in
`box.json`, not `box.local.json`.

It is a record kept by the maintainer and the agent, not a lock or an install mechanism: nothing
installs from it and no script polices it. Features still observe their own runtime status (for
example `artifact-sharing-status`), and a powerup's `## Detect` section is how an agent checks the
actual Box before acting, such as when backfilling the ledger in a Box that adapted recipes before it
existed. The Recipe Gallery reads the ledger (see below).

## What a recipe is not

A recipe describes its domain code, server controllers, web routes, imported packages, migrations,
setup decisions and gotchas. Its imports plus prose are its dependency description, and `RECIPE.md`
is descriptive prose, not a manifest. There is no `box adopt`, one-click install, `app.json`,
`deps.json`, feature package manifest, registry catalogue, release tag, or mount and compose
workflow. The root workspace package owns packages imported by the shared feature tree.

The Stack carries every maintained recipe: reminders, sink, Data Sync, planning, content, CRM, chat,
automation, comms (communications), notifications, engagement, artifacts, sso and mobile. The Mobile app recipe is the
one whose code ships with core ([MOBILE.md](MOBILE.md)): adapting it makes the shipped app the Box's
own and records it in the ledger, and each recipe's `mobile` powerup requires it. A consumer Box starts with core and
adapts only the recipes its team chooses.

[Builder](BUILDER.md) is a core administrator workspace, not a recipe.

## The Stack source

A Box names the Stack it adapts from with `stack.source` in `box.json`. The default is
`silkweave/stack` (GitHub shorthand). A git URL or a filesystem path, such as `..` for a Box nested
inside a Stack checkout, also works, and `box.local.json` can override it for one machine. See
[CONFIGURATION.md](CONFIGURATION.md).

- `box stack where` prints the configured source, its kind and location, and for a local path its
  `HEAD` and whether `recipes/` and `features/` exist.
- `box stack fetch [--ref <rev>] [--quiet]` returns a readable Stack. A local path is validated and
  printed and never modified; if `--ref` differs from its `HEAD` the command warns. A git source is
  cloned into the gitignored `<box>/.stack/` cache, fetched, and checked out detached at the ref,
  defaulting to `origin/HEAD`, the remote's default branch. It prints the path and the resolved commit; `--quiet`
  prints only the path.

See [CLI.md](CLI.md). The Stack repository is private today and will become public; a git source
needs access until then.

## Adapting a recipe

The agent reads `recipes/<id>/` locally, then runs `box stack fetch --ref <sha>` and reads
`<fetched stack>/features/<id>/`. Use the Stack revision recorded in the Box's `docs/UPSTREAM.md`
so the documents and code match; when adapting from a newer revision, record that revision instead.
The agent reads `docs/GOTCHAS.md` and the Box's local gotchas, then copies and adapts the relevant
core, server, web and skill code into `features/<id>/`, adds required packages, updates
`src/generated/features.ts` and `packages/core/src/generated/exports.ts`, and runs build, typecheck,
lint, tests and `schema:check`. Build and type errors during adaptation are part of the work.
Adapt the recipes listed under `## Builds on` first.

A recipe with folders under `recipes/<id>/powerups/` offers optional powerups. Before adapting, ask
the owner which of them to add now; each can be added later. Adapt and validate the base recipe
first, then follow each chosen powerup's `INSTALL.md`. Record the recipe in the `recipes` ledger once
the validation chain passes, and each powerup once its Verify steps pass. The mobile powerup's steps and
[MOBILE.md](MOBILE.md) cover the mobile app.

In a live Builder session, the agent then runs `box app restart` to activate server and
registration changes without stopping the stable supervisor, and validates the refreshed Preview.
An agent session lists the Box's MCP tools once, when it starts, so a recipe's new tools (`comms-*`,
say) do not appear in the session that adapted it; use the `box <tool>` CLI there, or a new
session, to exercise them.
Record durable local findings in the Box's `docs/GOTCHAS.md`.

Migrations are the carve-out. Preserve existing names and bodies byte-for-byte. Back up before
applying, stage the minimum runner and registration, apply migrations before unrelated changes, and
confirm boot. New behaviour requires a new migration. The warehouse ledger checks its digest;
chat's current ledger does not.

## Onboarding and the Recipe Gallery

The onboarding dashboard recommends three recipes not yet adapted (reminders, chat and artifacts
first, topped up from other recipes whose `## Builds on` are met) and asks which one Builder should
adapt first. Below them a callout opens the **Recipe Gallery**. A Box's own dashboard replaces
onboarding later; the gallery stays.

The gallery is the core route `/recipes`, linked from the Work menu below "Build". It shows every
recipe found in `recipes/*/RECIPE.md`, with search, an All, Available and Adapted filter, and a detail
dialog that carries the summary, highlights, what the recipe builds on, its screenshots and its
powerups. Each powerup is a row: Added, Available (administrators get "Add") or Locked with the reason,
such as "Adapt Chat first" or "Requires Mobile app". The route renders for members too, without the
adapt and add buttons.

A recipe counts as adapted when it is in the ledger or registered as a feature in the running Box, so
an older Box still shows its recipes. A registered recipe that is not in the ledger shows a "Not
recorded" badge, and administrators get a "Record with Builder" brief that backfills it. A powerup's
added state comes only from the ledger. An adapted recipe's button reads "Update recipe", with a brief
that compares the recorded revision, the Box and the Stack and updates the powerups recorded for it.

"Adapt recipe" opens Builder with a prefilled brief in the composer. The brief is only a draft: the
owner reviews and edits it, then sends it. It is never sent automatically, and choosing a recipe
changes nothing until the Builder agent does the adaptation described above. The brief ends with
recording the recipe in the ledger once validation passes. See [BUILDER.md](BUILDER.md) and
[WEB.md](WEB.md).

## Updating and resuming

Use `$adapt` for one recipe, `$upgrade` for core, and `$verify` for the whole Box. Compare the
recorded previous upstream commit, local code and target upstream commit. Keep full commit SHAs and
path mappings in `docs/UPSTREAM.md`; a date or release label alone does not identify the ancestor.
Write the intended steps and completed results as work proceeds in `_docs/INTEGRATION.md`. On resume,
inspect actual files and migration ledgers before replaying a step. Advance completed SHAs only
after verification, and record deliberately skipped upstream changes.

When a consumer lacks a recorded source SHA, recover the closest ancestor from its repository
history before adapting. Never bulk-replace customized files or rename shipped migrations.
