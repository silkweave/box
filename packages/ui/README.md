# `@silkweave/box-ui`

The Box component library: the design tokens, the primitives, the app shell, and the few composite
components (users, the markdown editor, channel glyphs) every Box needs.

**The contract:** everything here renders with nothing but React and this package's stylesheet in
scope. No tRPC client, no session, no feature registry, no agent host. That is what makes it
reusable, and Storybook is how it is enforced - if a component cannot render there, it is an app
component and belongs in `apps/web`.

That is the easy half, and this package has always passed it. The half that needs saying out loud,
because breaking it type-checks fine:

> **A component here may not compose English about the domain, decide when it is pointless to
> render, or own a storage key.**

Those three are how application logic actually gets in. `ShowAllToggle` did all of them at once - it
built `"Show 4 done initiatives"` out of a count and a noun, returned `null` when the count was
zero, and persisted `silkweave.<section>.showAll` - and underneath it was a `Button` with
`aria-pressed`. It is gone; the policy lives in `apps/web/src/lib/showAll.tsx`.

The corollary is naming: a component is named for what it IS, not what it was first used for.
`GroupByControl` was a segmented control that hard-coded the words "Group by". `TagPicker` was a
token picker that lowercased everything on the way out, which is right for tags and corrupts
anything with an identity. `RunLog` exported a server wire type. `formatMrr` formatted money. The
app keeps its vocabulary in thin adapters - `apps/web/src/lib/tags.tsx`,
`apps/web/src/lib/rowCount.ts` (which turns two counts and a noun into "17 / 53 accounts" so
`GridFooter` never has to) are the shape to copy. An adopted app does the same in its own
directory: the planning app's `StatusPill.tsx` is that pattern at feature scope.

**A component without a story is not in the library.**

```
bun run --filter @silkweave/box-ui storybook        # http://localhost:6006
bun run --filter @silkweave/box-ui typecheck        # also type-checks every story
```

## Storybook

The sidebar reads top-down as the library is meant to be learned, and `storySort` in
`.storybook/preview.tsx` fixes that order (everything else sorts alphabetically):

| Namespace | What |
|---|---|
| `Foundations/` | The token system itself: Welcome, Colors, Typography, Spacing, Radii, Shadows, Motion, Iconography. These pages are the ONE place raw `var(--token)` is correct, because the token IS the subject |
| `Brand/` | The mark and the wordmark |
| `Layout/` | The app shell and page scaffolding |
| `Base/` | The unopinionated primitives - no domain knowledge |
| `Board/` | The kanban board, the card frame it drags, and the controlled bar above a board view |
| `Charts/` | The plotted forms - a time series, a multi-series line, a sparkline - and the validated series palette they draw with |
| `Grid/` | The data-grid frame: the sticky header you can drag the dividers of, and the sticky footer that totals what is on screen |
| `Users/`, `Editor/`, `Ops/` | The namespaces that carry a seam of their own |

**Storybook does not dictate spacing.** The preview is `layout: 'fullscreen'` globally and the
theme decorator contributes only the canvas colour, so a story gets the full area by default -
which is what AppShell, Sidebar, TopBar, SplitPane and the editor all want, and what every one of
them used to have to opt out of one at a time. A story that would otherwise hug the edge opts IN
with `decorators: [withStage]` (`src/stories/Stage.tsx`), so the house gutter is one value in one
file rather than a `p-6` copied into thirty stories. `<Stage>` takes `inset` and `center` for the
story that needs something else.

The chrome is ours, not stock: `.storybook/theme.ts` mirrors `src/styles/tokens.css` into the
manager theme (literal colors - the manager is a separate document and never loads the library's
stylesheet), `.storybook/manager.ts` keeps it in step with the toolbar's Theme control, and
`public/manager.css` covers what the theme API cannot reach. Telemetry, the "What's new" feed, the
crash reporter and the onboarding checklist are all off in `.storybook/main.ts`. The manager's
fonts are served out of `staticDirs` from the same `@fontsource` packages the preview bundles - no
CDN at runtime, in the manager or the preview.

There are no autodocs "Docs" pages and `@storybook/addon-docs` is not installed: nobody - human or
agent - reads a generated prose page for a Button, and a Docs entry beside every component doubles
the sidebar and buries the stories that actually show the thing. The stories ARE the documentation.
Prop types and their TSDoc still reach the Controls panel, because `typescript.reactDocgen` is
independent of the docs addon. Anything that genuinely needs prose is a Foundations page, which is
an ordinary story.

Two things will cost you an hour if you do not know them:

- **`public/manager.css` is `<link>`ed, not inlined.** Storybook caches the manager's generated
  `index.html`, so an inlined `<style>` goes stale and only `rm -rf node_modules/.cache/storybook`
  clears it. Linked, a refresh is enough.
- **The `!important`s in it are load-bearing.** Storybook's chrome is styled with Emotion, which
  injects its `<style>` tags at runtime and therefore after ours.

## Using it

```ts
import { Button, AppShell, UserPicker } from '@silkweave/box-ui'
import { BoardKanban } from '@silkweave/box-ui/board'   // + the dnd-kit peers
import { TimeSeriesChart } from '@silkweave/box-ui/charts' // + the recharts peer
import { DocEditor } from '@silkweave/box-ui/editor'   // + the TipTap peers
import { cn, usePersistedState } from '@silkweave/box-ui/lib'
```

### Entry points are cut by dependency footprint, not by taxonomy

| Entry | Needs |
|---|---|
| `.` | React, `@base-ui/react`, `lucide-react`, `class-variance-authority` |
| `./board` | + `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `./charts` | + `recharts` |
| `./editor` | + the eight `@tiptap/*` packages |
| `./lib` | nothing - DOM and React only |
| `./styles/*.css` | n/a |

The heavy ones are declared as **optional peer dependencies** (`peerDependenciesMeta`), not
`optionalDependencies` - that field means "install this but tolerate a failed build" and installs
for everyone. They are also `devDependencies` here so this package's own typecheck and Storybook can
resolve them, which is free because it is private and never published.

This is forced by the no-build decision below, not chosen for elegance: with `src/` resolved
directly, whatever the root barrel re-exports is walked by tsgo and by Vite's dependency scanner on
**every** import of it. A barrel that re-exported the editor would make a Box that never opens one
fail to resolve TipTap. Tree-shaking never gets a say - resolution fails first.

```css
/* Your app's entry stylesheet. Add an @source line for your own src/. */
@import '@silkweave/box-ui/styles/globals.css';
@source '../';
```

There is no build step. Both consumers resolve the `@silkweave/box-source` export condition
straight to `src/`, so an edit here is live in the app and in Storybook with no rebuild.

## The seams

Where a component needs data an app owns, the app registers it into the library - never the
reverse. Three of them, each picked for what actually crosses:

| Seam | Mechanism | Why |
|---|---|---|
| `ShellExtensionsProvider` | context, set once at the app root | `AppShell` needs a top-bar cluster, an optional aside panel, an inert flag, and the link that wraps the wordmark (`homeLink` - the app's router `<Link to='/'>`; the default is a plain `<a href='/'>`, because a router is the one dependency this package must never take). One provider, and `<AppShell>` still renders standalone from the `{}` default - which is the story that proves the shell carries no app dependency. |
| `UsersProvider` | context, value is DATA (`AvatarUser[]`) | Twenty-odd feature call sites render an avatar or a picker without passing users. Threading a prop to each leaf is the case a context exists for. `null` means "not loaded" and is deliberately distinct from `[]`. |
| `doc: DocHandle` | a plain prop | `DocEditor` is controlled, like an `<input>`. Loading and saving is the app's business - apps/web routes it over tRPC to three different controllers by `kind`, and none of that may cross. |

`UserMenu` takes props rather than a context: it renders exactly once, and every input (who is
signed in, what sign-out means, where the active user is persisted) is a policy the library should
not hold an opinion about.

Note what is NOT here: a registration function. The server's idiom (`registerSignalHooks`,
`onEvent`) registers behaviour into a module-level list at boot, but these are React nodes and
hooks - HMR would re-register them, and a story could not override them per story. A context is the
same rule with the runtime doing the bookkeeping.

## Layout

| Path | What |
|---|---|
| `src/components/` | Primitives: Button, Badge, Dialog, Popover, Select, DateInput, TokenPicker, Figures, UrlInput, ActionListRow, Confetti, … |
| `src/shell/` | AppShell, Sidebar, TopBar, PageContainer, CollapsibleSection, EmptyState, ThemeToggle, and the `ShellExtensions` seam |
| `src/settings/` | The settings detail pane (`SettingsPane`: title bar with breadcrumbs, scroll surface, footer slot) and the section vocabulary: intro, list and rows, group, field, footer bar |
| `src/board/` | The board: `BoardKanban`, the `DraggableCard` frame both card shapes share, and the controlled `BoardViewBar`. Its own entry point |
| `src/charts/` | The charts: `TimeSeriesChart`, `SeriesLineChart`, `Sparkline`, the tooltip/legend frames, the window helpers and `theme.ts`'s series palette. Its own entry point |
| `src/grid/` | The data grid: `columns.ts` (order, widths, footer aggregates) plus `GridHeader` and `GridFooter` |
| `src/users/` | The directory seam, Avatar's `AvatarUser` shape, UserPicker, UserChip, AccountMenu |
| `src/editor/` | The TipTap markdown editor behind its lazy boundary, and the `DocHandle` seam. Its own entry point |
| `src/icons/` | `createIconTable` + `BRAND_ICONS` - the MECHANISM for a string-keyed glyph table with a fallback. The table itself is an app's vocabulary and lives in `apps/web/src/lib/channelIcons.tsx` |
| `src/lib/` | `cn`, `usePersistedState`, `theme`, `storage`, `swatches` - the `@silkweave/box-ui/lib` entry |
| `src/styles/` | `globals.css` (Tailwind + the `@theme` bridge), `tokens.css`, `fonts.css` |
| `src/stories/` | Fixtures for stories, and `foundations/` - the pages that document the token system |
| `.storybook/` | Config, the manager theme, and the preview decorators |
| `public/` | `manager.css` and the mark, served as static files by Storybook |

**Persisted preferences carry a `storagePrefix`, defaulting to `ui`.** The library used to write
`silkweave.sidebar.collapsed`, `silkweave.sidebar.groupExpanded` and `silkweave.theme` - one
product's brand stamped into every consumer's localStorage, and two Boxes on one origin fighting
over the same keys. `AppShell` and `Sidebar` take the prefix as a prop and the `theme` helpers take
the key as an argument; `SplitPane` already required a `storageKey` and is the pattern the rest now
follows.

**An app sets that prefix ONCE, on `ShellExtensions`** (2026-09-15), not per `<AppShell>`. The prop
still wins where it is passed - a story needs that - but a namespace repeated at route call sites
will split as soon as one is omitted. `Sidebar` and `SidebarRail` thread it into
`ThemeToggle` for the same reason: before this, a Box that set `storagePrefix` still had its theme
toggle writing `ui.theme`, and half a namespace is the bug the parameter exists to prevent.

**A persistent `AppShell` takes navigation lifecycle keys.** Change `navigationKey` whenever a
navigation commits so an open mobile drawer closes even for browser or programmatic navigation.
Change `scrollResetKey` only when the owning section changes so the shell-owned `<main>` returns to
the top while same-section navigation and inner feature scrollers keep their positions. Group,
secondary-item, and home selections also close the drawer immediately, including same-URL clicks.

**The grid's storage key is the caller's, in full** - `useColumnWidths(appKey('crm'))`. That is a
deliberate difference from `storagePrefix`: the shell's keys name a SHELL concept (the sidebar, the
theme) and the library can build them, while a grid's key names one of the app's boards, which is
vocabulary. `storageKey()` in `./lib` is there for a caller that wants the house prefix.

**`BoardViewBar` is controlled and owns nothing.** `value` in, a PATCH out - never a whole state
object, because switching the sort field writes two fields at once and an app's state is narrower
than the bar's (its filter axes are enums) and carries more. Where the view lives - a store,
localStorage, the URL - is the app's, and the preset control is a `presets` SLOT rather than a
component here, because a preset is a record on somebody's server. The data app's
`ViewBar.tsx` (adopted, not in this repo) is one binding of the two.

**A chart plots numbers; the app supplies the words.** Every label, caption, headline and tooltip
sentence in `src/charts/` is a prop - a `ReactNode` or a formatter - because the vocabulary of a
measure belongs to the feature that owns it. `SignalChart` reads the delta out ("+184 (12.4%) over
30D") and hands the plot a `header`; `SprintBurndown` says "not yet" and "planned" through
`renderTooltip`. The window selector on `TimeSeriesChart` is controlled for the same reason
`BoardViewBar` is: the current window usually belongs to a URL or a stored view.

**The series palette is eight tokens in a validated ORDER, and the order is a safety property.**
`--chart-1..8` in `tokens.css` carry both themes' steps; `seriesColor(i)` hands them out in fixed
order and never cycles, so a filter that drops series does not repaint the survivors. The steps and
their order were checked pairwise - colour-vision simulation, lightness band, chroma, contrast -
against this Box's own chart surface in both modes, with the `dataviz` skill's validator. Only the
first three clear the tighter all-pairs bar, which is the cap for forms where every series touches
every other (scatter, bubble, small multiples). Changing a value means re-running the validator; do
not eyeball it.

`cn` must exist exactly once in a running app: its tailwind-merge config is tied to the `@theme`
font-size scale in `tokens.css`, so a second copy silently drops sizes. `apps/web/src/lib/utils.ts`
is an alias onto this one, not a rival.

## Consumer branding

Wrap the app in `BrandProvider` with `{ name, wordmark, suffix, logoUrl }` to supply its identity
to `Mark`, `Wordmark` and every shell layout. The library imports no application config. Without
a provider it renders neutral Box text; the mark is omitted. See `Brand/Wordmark` for an example.
