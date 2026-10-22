# Recipes

A recipe is something the Silkweave Stack offers and a Box can adapt. This directory holds the
documentation half of every recipe. The reference implementation lives in the Stack under
`features/<id>/` (`core`, `server`, `web`, plus the parts its powerups add, such as `mobile`). Adapting a
recipe copies and adapts that code into the Box's own `features/<id>/` and registers it, after which
it is a feature of that Box. The recipe id and the feature id are the same string.
[docs/RECIPES.md](../docs/RECIPES.md) describes the whole model.

A recipe adopts a feature in its base form. Optional capabilities for it are **powerups**: each one
is a folder under `recipes/<id>/powerups/` that a Box can add when the recipe is adapted or any time
later.

`recipes/` is a managed core path. `bun run box:build` and `$upgrade` refresh it with core, so every
Box carries the documents for every recipe offered to it, whether or not it has adapted them. Do not keep local
notes here; Box-specific findings belong in the Box's `docs/GOTCHAS.md`.

## Layout

```text
recipes/<id>/
  RECIPE.md       catalog entry: title, summary, highlights, builds on
  SPEC.md         runtime contract and behavior of the feature the recipe produces
  INSTALL.md      adaptation procedure: prerequisites, migrations, validation
  AGENT.md        adaptation and customisation guide
  GOTCHAS.md      recipe-specific hazards
  screenshots/    images shown in the Recipe Gallery
  powerups/<powerup>/
    POWERUP.md    catalog entry: title, summary, highlights, needs, requires
    INSTALL.md    procedure: detect, requires, owner decisions, owner-only steps, steps, verify, remove
```

A folder without `RECIPE.md` is not listed in the catalog, and a powerup folder without
`POWERUP.md` is not offered.

## RECIPE.md format

The Recipe Gallery (the `/recipes` route) parses `RECIPE.md` at build time, so its first blocks follow a fixed
shape:

```markdown
# <Title>

<One summary paragraph, one or two sentences, plain text.>

## Highlights

- <three to five short, concrete capabilities, plain text>

## Builds on

- [<Title>](../<dep-id>/RECIPE.md)
```

- The first `# ` heading is the title. Keep it a short product name.
- The first paragraph after the title is the summary. Write it as the outcome for the team, without
  links or emphasis.
- Bullets under `## Highlights` become the highlight list.
- Links under `## Builds on` name the recipes that must be adapted first. The catalog reads the id
  from each `../<id>/` link target. Omit the section when the recipe needs only core.
- Further prose sections may follow these blocks; the catalog ignores them.

`RECIPE.md` is descriptive prose, not a manifest. Nothing installs from it. There is no registry,
one-click install, dependency manifest, or mount and compose workflow.

Do not list powerups in `RECIPE.md`. The catalog finds them in `powerups/`, so adding one never
edits the recipe.

Screenshots are `screenshots/*.{png,jpg,webp,svg}`, shown in filename order, so prefix them with a
number (`01-overview.png`, `02-detail.png`). The shipped SVGs are placeholders until real captures
replace them.

## Powerups

A powerup is an optional capability for an adapted recipe: the recipe's mobile module, or public
hosting for artifacts. The recipe stays complete without it. Each powerup is one self-contained
folder, so it can be reviewed, added and removed as one unit.

`POWERUP.md` follows the same shape as `RECIPE.md`:

```markdown
# <Title>

<One summary paragraph, plain text.>

## Highlights

- <what it adds, plain text>

## Needs

- <accounts, tools and decisions the owner brings, plain text>

## Requires

- [<Recipe title>](../../../<recipe-id>/RECIPE.md)
- [<Powerup title>](../../../<recipe-id>/powerups/<powerup-id>/POWERUP.md)
```

`## Requires` is optional and lists what must be in place before the powerup can be added, as links
to recipes or to powerups of the same or another recipe: `../../../mobile/RECIPE.md` for a recipe,
`../../../artifacts/powerups/public-sharing/POWERUP.md` for a powerup of another recipe, or a
sibling `../<powerup>/POWERUP.md`. The powerup's own recipe is always required and is not listed.
The Recipe Gallery locks a powerup until its recipe is adapted and every requirement is met (a recipe
adapted, a powerup recorded in the [ledger](../docs/RECIPES.md#the-recipe-ledger)). The `## Requires`
section of `INSTALL.md` states the same in prose for the agent.

`INSTALL.md` is the procedure an agent follows, with these sections in order:

| Section | Says |
|---|---|
| `## Detect` | How to confirm the Box's actual state, from files or the running Box, for example before recording the powerup in the `recipes` ledger or when backfilling the ledger in a Box that predates it. |
| `## Requires` | The recipe (and any other powerup or recipe) that must be in place first. |
| `## Owner decisions` | Choices the agent asks for before changing anything. |
| `## Owner-only steps` | What only the owner can do (sign in to an outside account, create a key), and when. |
| `## Steps` | The agent's steps, including where source comes from and where secrets go. |
| `## Verify` | Checks that prove it works end to end, beyond the validation chain. |
| `## Remove` | How to take it out again, including anything held outside the Box. |

Source a powerup needs lives in the Stack beside the recipe's, under `features/<id>/<part>/`, and is
fetched with `box stack fetch` like the rest. A feature without a powerup must say so plainly where
the missing capability would appear, name the powerup, and point administrators to it.

## Adapting a recipe

1. Read `recipes/<id>/` in the Box: `RECIPE.md`, `SPEC.md`, `INSTALL.md`, `AGENT.md` and `GOTCHAS.md`.
2. Fetch the implementation with `box stack fetch --ref <sha>`, using the Stack revision recorded in
   the Box's `docs/UPSTREAM.md` so documents and code match. The command prints the path of a
   readable Stack; `stack.source` in `box.json` says where it comes from, and `box stack where`
   shows the current setting.
3. Read `<fetched stack>/features/<id>/` and adapt it into the Box's `features/<id>/`, then update
   registration, install the packages its imports need, and run the Box validation chain.
4. Add the powerups the owner wants by following each one's `INSTALL.md`, now or later.
5. Once the validation chain passes, record the recipe in the `recipes` ledger of `box.json`, and each
   powerup once its Verify steps pass (see [RECIPES.md](../docs/RECIPES.md#the-recipe-ledger)).

The `$adapt` skill carries the full procedure, including the migration rules.
