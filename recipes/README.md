# Recipes

A recipe is something the Silkweave Stack offers and a Box can adapt. This directory holds the
documentation half of every recipe. The reference implementation lives in the Stack under
`features/<id>/` (`core`, `server`, `web`, and `mobile` when the recipe has a mobile module). Adapting a recipe copies and adapts that code into the Box's own `features/<id>/`
and registers it, after which it is a feature of that Box. The recipe id and the feature id are the
same string. [docs/RECIPES.md](../docs/RECIPES.md) describes the whole model.

`recipes/` is a managed core path. `bun run box:build` and `$upgrade` refresh it with core, so every
Box carries the documents for every recipe, whether or not it has adapted them. Do not keep local
notes here; Box-specific findings belong in the Box's `docs/GOTCHAS.md`.

## Layout

```text
recipes/<id>/
  RECIPE.md       catalog entry: title, summary, highlights, builds on
  SPEC.md         runtime contract and behavior of the feature the recipe produces
  INSTALL.md      adaptation procedure: prerequisites, migrations, validation
  AGENT.md        adaptation and customisation guide
  GOTCHAS.md      recipe-specific hazards
  screenshots/    images shown in the onboarding recipe catalog
```

A folder without `RECIPE.md` is not listed in the catalog. `artifacts/` is such a folder: the Stack
carries only a web placeholder for it, so it has a note and no catalog entry.

## RECIPE.md format

The onboarding recipe catalog parses `RECIPE.md` at build time, so its first blocks follow a fixed
shape:

```markdown
# <Title>

<One summary paragraph, one or two sentences, plain text.>

## Highlights

- <three to five short, concrete capabilities, plain text>

## Builds on

- [<Title>](../<dep-id>/RECIPE.md)

## Mobile

- <what the optional mobile module adds, plain text>
```

- The first `# ` heading is the title. Keep it a short product name.
- The first paragraph after the title is the summary. Write it as the outcome for the team, without
  links or emphasis.
- Bullets under `## Highlights` become the highlight list.
- Links under `## Builds on` name the recipes that must be adapted first. The catalog reads the id
  from each `../<id>/` link target. Omit the section when the recipe needs only core.
- Bullets under `## Mobile` say what the recipe's mobile module (`features/<id>/mobile`) adds to
  the Box app. Include the section only when the recipe has one; the catalog shows it and the
  adapt brief asks the owner whether to include the module.
- Further prose sections may follow these blocks; the catalog ignores them.

`RECIPE.md` is descriptive prose, not a manifest. Nothing installs from it. There is no registry,
one-click install, dependency manifest, or mount and compose workflow.

Screenshots are `screenshots/*.{png,jpg,webp,svg}`, shown in filename order, so prefix them with a
number (`01-overview.png`, `02-detail.png`). The shipped SVGs are placeholders until real captures
replace them.

## Adapting a recipe

1. Read `recipes/<id>/` in the Box: `RECIPE.md`, `SPEC.md`, `INSTALL.md`, `AGENT.md` and `GOTCHAS.md`.
2. Fetch the implementation with `box stack fetch --ref <sha>`, using the Stack revision recorded in
   the Box's `docs/UPSTREAM.md` so documents and code match. The command prints the path of a
   readable Stack; `stack.source` in `box.json` says where it comes from, and `box stack where`
   shows the current setting.
3. Read `<fetched stack>/features/<id>/` and adapt it into the Box's `features/<id>/`, then update
   registration, install the packages its imports need, and run the Box validation chain.

The `$adapt` skill carries the full procedure, including the migration rules.
