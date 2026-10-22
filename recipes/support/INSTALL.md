# Adapt the support recipe

This is the adaptation guide for the support recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's `docs/UPSTREAM.md`, and its current
`_docs/INTEGRATION.md` before changing files. These recipe documents ship with core, so a Box has
them at `recipes/support/`. The reference implementation does not: it is fetched from the recipe registry as `features/support/`. In a Box, run `box recipe fetch support` and read `<fetched recipe>/features/support/` (`<fetched recipe>` is the path it prints),
so the documents and the code come from the same version.

## Prerequisites

- An existing Box backup and a recorded restore path for both data and matching application source.
- Core, with the team time zone set. This recipe builds on no other recipe.
- Feature-specific package imports: none beyond what core and `@silkweave/box-ui` already provide
  (the ticket summary uses the same markdown editor packages as the CRM account doc; install them
  into the root workspace package if the Box does not have them yet).
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), and an integration entry with scope, target version,
  intended changes and state in `_docs/INTEGRATION.md`.
- A disposable instance for build, typecheck, tests, schema checks and boot verification.

## Owner decisions

Ask these together before copying code:

1. **Powerups.** Which to add now: `crm` (needs CRM) and `help-center`
   (the public Help Center on Cloudflare Pages; its contact form needs Automation). Each can be
   added later. Adapt and validate the base first.
2. **Working week.** Working days, public holidays for the coming year, and when a ticket counts as
   late (default: more than 1 working day).
3. **Phone numbers.** The default country code for numbers typed without one.
4. **Existing help content.** Whether to import articles, FAQ answers and guides from where they
   live today (an export file, a help desk, a docs site). The import is a one-off script; see
   Integration.

## Integration

The tables are created on boot. The shipped migrations (`support:001` to `016`, SPEC.md
"Migrations") drop columns and tables outside the current model; on a Box adapting the recipe
each is a no-op, so there is no migration stage.

1. Copy/adapt `<fetched recipe>/features/support/` into the Box's `features/support/{core,server,web}`
   and `features/support/skills/`, without the powerup folders the owner did not choose
   (`core/crm/`, `core/help-center/` and their `server/` and `web/` counterparts,
   and the `cloudflare/` folder, which belongs to `help-center`). `core/articles/`,
   `server/articles/`, `web/articles/` and `web/lib/media.ts` are the base's Help Articles: keep them. Remove their registration lines from
   `core/index.ts`, `core/manifest.ts` (models and `dependsOn`), `server/support/support.module.ts`
   and `web/index.tsx` (routes, sections, slot contributions and `onSession`). The base alone has no
   `dependsOn`. Register the result as the `support` feature in
   `apps/server/src/generated/features.ts`, `apps/web/src/generated/features.ts`,
   `packages/core/src/generated/features.ts` and `packages/core/src/generated/exports.ts`. Link the
   skill with the skill linker.
2. Keep the sidebar section the two nav entries declare (`SUPPORT_SECTION` in
   `web/articles/index.ts`, `{ id: 'support', label: 'Support', order: 600 }`), or point both
   entries at another section of the Box. An entry without a section falls under "Other".
3. Configure `features.support` in `box.json` with the owner's answers (SPEC.md, "Settings").
4. **Import**, if the owner chose it: a script in `_docs/scripts/` that calls
   `support-article-upsert` (with `type` `article`, `faq` or `getting_started`) with `import_key`
   set to the source's id, so a re-run updates instead of duplicating. Map the source's states to
   `draft`, `published` and `retired`, and name in `team_notes` any image the export left out.
5. Preserve local customizations and write durable findings to the Box's `docs/GOTCHAS.md`. Record
   path mappings and skipped parts; update `_docs/INTEGRATION.md` as each step completes.

## Validation

Run `box verify` (build, typecheck, lint, tests, `schema:check`), then boot a disposable instance
with background work off and exercise the surface:

1. `box support-ticket-log --summary "Cannot reset password" --channel email --type how_to
   --requester-email Pat@Example.com` creates ticket 1 and a requester `pat@example.com`; the same
   call with `--source-ref call-1` twice returns `created: false` the second time.
2. A requester with phone `0151 2345678` (with `defaultCountryCode` `49`) is stored as
   `491512345678`; creating another requester with `+49 151 2345678` is refused naming the first.
3. In the browser: the sidebar shows Support Tickets under a "Support" heading, with the presets
   Open, Mine, Unassigned, Late, Blocked, Closed and Everything. `/support` lands on Open with the
   ticket at age 0 and status Pending. Set its owner in the grid; switch to the board, group by
   Status and drag the card to Done: it leaves Open and shows under Closed. Opening the ticket adds
   it to Recent Tickets; on its page rename it in the breadcrumb, set Blocked from the top bar, and
   type in the summary on the right.
4. On the ticket page, edit the requester's phone to one another requester has: the panel offers
   the merge; keep one and the ticket follows. "All tickets from ..." opens the view filtered to
   that requester. New ticket (the dialog from the top bar) with a known email offers the known requester instead of a second.
5. Help Articles: create a draft article and a draft FAQ entry and publish both: `published_on`
   is today. Edit the article's body: `content_updated_on` is today; toggle Featured: it is not.
   Link the ticket to the article: the article's page counts it; deleting it is refused, retiring
   it works. Under `/support/help`, Help Articles is the active sidebar item with Presets and
   Recent Articles; on the Board, drag a draft to Published.
6. Settings > Support shows the tabs Working week, Support Tickets and Help Center, with Save in
   the footer; Save on one tab changes only that tab's keys in `box.local.json`. Without the
   help-center powerup, its tab and the Help Center button on Help Articles say what it adds, and
   an administrator sees "Add with Builder".
7. Load every changed route in a browser (a module-scope registry read only shows there).

Record the actual commands and results in `_docs/VALIDATION.md`. Once the chain passes, add
`"support": { "powerups": [] }` to `recipes` in `box.json`, then follow each chosen powerup's
INSTALL.md.
