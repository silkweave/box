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
app keeps its vocabulary in thin adapters - `apps/web/src/lib/tags.tsx` is the shape to copy. An adopted app does the same in its own
directory: the planning app's `StatusPill.tsx` is that pattern at feature scope.

**A component without a story is not in the library.** The story renders the production
component, never a rebuild of its parts, with one fixture for every branch that changes what it
draws: an option count past a threshold, `iconOnly`, read-only, empty, long text, a narrow host.
Each fixture sits in an element with `data-fixture`, and the component's rendered contract is a
spec in `test/rendered/` that measures the element carrying the meaning (the glyph, not only its
button), checks the interactions (open, pick, clear, Escape returns focus) and must fail when the
contract breaks. `cells.stories.tsx` with `test/rendered/cells.spec.ts` is the shape to copy.

```
bun run --filter @silkweave/box-ui storybook        # http://localhost:6006
bun run --filter @silkweave/box-ui typecheck        # also type-checks every story and spec
bun run --filter @silkweave/box-ui test:rendered    # builds Storybook, runs the specs headless
```

The rendered gate needs a headless Chromium (`bunx playwright-core install chromium-headless-shell`
once); without one it fails rather than skipping. `box verify` runs it in the Stack checkout only:
a Box, and a Builder session in one, does not. Screenshot baselines (`test/rendered/screens/`) are
reviewed pictures from the maintainer's macOS machine; accept new ones with `--accept` only after
looking at the diffs in `node_modules/.cache/rendered-diffs/`.

## Choosing a component

Find the need, use the piece, and do not reach for the third column. Each piece's doc comment says
the same in more detail, and its story shows it. Rules behind the table: `docs/DESIGN.md`.

### Controls, actions and display

| Need | Piece | Not this |
|---|---|---|
| A text value in a form | `Input` inside a `Field` | a raw `<input>`, a private `inputCls`, `settingsInputCls` |
| Long text or code | `Textarea` (`autoGrow`, `mono`) inside a `Field` | a raw `<textarea>` |
| A label, hint and error around one control | `Field` | `SettingsField` (retiring), a hand-built `<label>` |
| Fields side by side | `FieldGrid` (3 columns for short values, 2 medium, 1 long) | `grid-cols-*` per section |
| One value from a list | `SelectField` | the `Select` parts (only for custom trigger or item content), a native `<select>` |
| Free text with suggestions | `Autocomplete` | `SelectField` (a closed set) |
| Several free values (tags) | `TokenPicker` | several inputs, a comma-separated `Input` |
| Several records picked by name (signals, kinds) | `TokenPicker` with `{ value, label }` options and `allowCreate={false}` | a `SelectField` plus a chip list |
| A saved set of short values shown as removable chips | `TagList` | hand-made chip spans with an X button |
| A colour | `ColorInput` | a raw `<input type='color'>` |
| Picking a file to upload | `FileButton` | a hidden `<input type='file'>` and a ref |
| A person | `UserPicker`; to show one, `UserChip` (an id) or `Avatar` (a user you hold) | a `SelectField` of names |
| A picker's long list (search past five, capped height) | `OptionList` inside `PopoverContent` (built into `SelectField`, `SelectCell`, `UserPicker`) | a hand-rolled list of buttons |
| The title bar of a tool popover | `PopoverHeader` (name, info tooltip) | an explanation paragraph in the panel |
| A date; a window of two dates | `DateInput`; `DateRangeInput` | `<input type='date'>`, two `DateInput`s for one window |
| A setting that takes effect as a state (enabled, armed) | `Switch` | a checkbox styled as a toggle |
| Picking items in a set, a yes/no form value | `Checkbox` | `Switch` |
| 2 to 5 options, all visible, that filter or regroup the screen | `SegmentedControl` | `TabNav` (pages), `SelectField` (more options) |
| Searching the list below | `SearchInput` | `Input` |
| An act | `Button` (`size='sm'` in compact surfaces) | a styled `<button>` |
| An icon-only act on a row or a toolbar | `IconButton` | `Button size='icon*'` without a label, `settingsRowActionCls` |
| Two or more secondary acts on a row or record | `ActionMenu` | a row of icon buttons, a hand-rolled menu, a bare trash icon |
| Copying a value; a read-only value with its copy button | `CopyButton`; `CopyField` | a clipboard call in a section |
| A link the kit draws | `NavAnchor` | `<a onClick>` that breaks Cmd-click |
| A state or a kind | `Badge` | coloured text |
| A health light | `StatusDot` | a hand-drawn dot |
| A run's output and its status | `LogViewer`, `StatusBadge` | a `<pre>` per line |
| A fold inside a form ("Advanced") | `Disclosure` | `<details>`, `CollapsibleSection` |
| A page section that folds | `CollapsibleSection` | `Disclosure` |
| A copy-once result (a new token) or a confirmation | `Dialog`; `confirm()` | a `Dialog` for an edit form |
| A failed write with nowhere else to say it | `notifyError()` (`NotifyHost` once) | `window.alert`, a private error paragraph |
| A message the person must read first (warnings after a write) | `notice()` | `window.alert` |
| Where an autosaving document stands | `SaveStatus` | a private "Saving…" badge |
| An app create form or a record's settings form | `RecordDialog` (hash-routed) | a hand-built `Dialog`, a create page |
| A record's own page | `RecordPage` | page padding, a footer with Save |
| An editor page opened from a list, outside Settings | `InlineDialog` in an `InlineDialogScope` | a modal `Dialog` |
| A small panel one click away | `Popover` | `Dialog` |

### Pages, lists and states

| Need | Piece | Not this |
|---|---|---|
| A page title | `PageHeader` | a hand-written `<h1>` |
| A page's width and padding | `PageContainer` | `max-w-*` per page |
| A view's create actions | `TopBarActions` (app pages), `SettingsHeaderActions` (Settings) | buttons in a heading above a grid |
| The pages of one view | `TabNav`; in Settings `SettingsTabs` | `SegmentedControl` |
| A whole page with nothing in it, and the act that fills it | `EmptyState` | `CenteredNote`, `SettingsEmpty` |
| A whole view loading, empty or failed | `CenteredNote` | `EmptyState`, a spinner in a corner |
| Any list of records: an app page, a Settings list, a section of a detail page | `DataGrid` (`./list`) | hand-written rows, group rows or tables, `GridHeader` over your own body |
| A row's name: name, second line, avatar or tile, one state | `NameCell` (`./list`) in `name.render` | two hand-sized `<p>`s, a `Badge` that grows the line |
| A grid cell that edits in place | `TitleCell`, `SelectCell`, `DateCell`, `TagsCell` (`./list`), `UserPicker`; a custom popover cell uses `CELL_BUTTON` (+ `CELL_ICON`); an always-shown icon column is `fixed` and `leading` | a private hover style or select, an `IconButton` in a cell |
| A feed or queue of items handled in place | `ActionListRow` | a `DataGrid` row |
| Columns you drag cards between | `BoardKanban` with `BoardViewBar` | `DataGrid` |
| A custom board of `DraggableCard`s | `useBoardSensors` and `boardCollision` on its `DndContext` (pointer and keyboard) | a `PointerSensor` alone, `pointerWithin` alone (a keyboard drop finds no target) |
| One measure over time; several on one scale; a trend in a card | `TimeSeriesChart`; `SeriesLineChart`; `Sparkline` | a second y-axis |

### Settings

| Need | Piece | Not this |
|---|---|---|
| A section's canvas | `SettingsPane`, with `SettingsIntro` and `SettingsInfo` | own padding or `SETTINGS_GUTTER` in a section |
| A detail or create page over the list | `SettingsPage` | `InlineDialog` and its parts assembled by hand |
| The identity of a detail page (avatar, status, address) | `SettingsDetailHeader` | `PageHeader` |
| Tabs in a section or a detail page | `SettingsTabs` | `TabNav` placed by hand, two levels of tabs |
| A group of fields | `SettingsGroup` with a `FieldGrid` | cards and borders |
| A Settings list (search, filters, sort, groups, count) | `DataGrid`, which adapts to the pane | a hand-made search field or toolbar |
| A named part of a dialog form | `FieldSection` with a `FieldGrid` | `SettingsGroup` (it draws the canvas gutter), a local heading and rule |
| Read-only label and value pairs | `SettingsFacts`, `SettingsFact` | a private `Row` or `Meta` |
| A row whose point is its control (a switch, a level) | `SettingsControlRow` in a `SettingsControlList` | a list row with a control wedged in |
| An outside system rewrote a value someone must accept | `SettingsChangedFrom` | a warning-styled span |
| Filter and Refresh above a log | `DataGrid` with Refresh in `actions` | actions in the title bar |
| Things whose fields fit a row, edited in place | `DataGrid` `editing` | a create page for 1 to 3 short values |
| An empty section that is not a list | `SettingsEmpty` | `EmptyState`, `CenteredNote` |
| First load; a failed load | `SettingsLoading`; `SettingsError` | a section's own spinner, a raw server message |
| A condition and its fix | `SettingsNotice` | a coloured card |
| The member view (cannot change) | `SettingsReadOnly` | hiding controls section by section |
| A form's draft, dirty state and Save | `useSettingsForm` with `SettingsSaveBar` | a private `dirty` flag or `useSubmit` |
| Delete on a detail page | `SettingsDeleteButton` in the save bar's `start` | Delete in a header menu, a trash icon on rows |

### Patterns

The pieces compose into page archetypes (List, Detail, Create, Form, Tabbed section, Overview,
Log; see `docs/DESIGN.md`). Each archetype gets a complete reference page as a story in
`src/stories/patterns/`, under `Patterns/` in Storybook; they are written after the pieces above
land. Start a new page from the nearest pattern story, not from a blank file.

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
| `./list` | + `@dnd-kit/core` |
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

`AccountMenu` takes props rather than a context: it renders exactly once, and every input (who is
signed in, what sign-out means, where the active user is persisted) is a policy the library should
not hold an opinion about.

Note what is NOT here: a registration function. The server's idiom (`registerSignalHooks`,
`onEvent`) registers behaviour into a module-level list at boot, but these are React nodes and
hooks - HMR would re-register them, and a story could not override them per story. A context is the
same rule with the runtime doing the bookkeeping.

## Layout

| Path | What |
|---|---|
| `src/components/` | Primitives: Button, IconButton, Input, Textarea, Field, SelectField, Switch, CopyButton, Badge, StatusDot, Dialog, Popover, DateInput, TokenPicker, Figures, ActionMenu, ActionListRow, Confetti, … |
| `src/shell/` | AppShell, Sidebar, TopBar, PageContainer, CollapsibleSection, EmptyState, ThemeToggle, and the `ShellExtensions` seam |
| `src/settings/` | The settings frame (`SettingsPane`: title bar with breadcrumbs, scroll surface, footer slot) and the section vocabulary: intro, page, detail header, tabs, group, control row, facts, save bar, states |
| `src/board/` | The board: `BoardKanban`, the `DraggableCard` frame both card shapes share, and the controlled `BoardViewBar`. Its own entry point |
| `src/filters/` | The typed filter kit: field types (options, person, date, number, text, boolean), the pure rules that match, repair, compare and summarize their values (`matchAll`, `normalizeAll`, `sameAll`, `pruneInactive`, `summarize`), the `FilterPanel` the bar's funnel opens, one editor per type, and `PinnedFilterChip`. Its own entry point |
| `src/charts/` | The charts: `TimeSeriesChart`, `SeriesLineChart`, `Sparkline`, the tooltip/legend frames, the window helpers and `theme.ts`'s series palette. Its own entry point |
| `src/list/` | `DataGrid`, the one list of records (an app page, a Settings list, a `card` or `section` of a page) on top of `BoardViewBar`: filter, sort, group, nest, fold, drag, edit in place. `Row`, `GroupRow`, `GridHeader`, `GridFooter` (internal to the list), `columns.ts` (order, widths, footer aggregates), `chrome.ts` (internal class strings), `useListView` (the view as state), `tree.ts`, `moves.ts` (the optimistic move queue), `useTreeDrag`, `useGlide`. Its own entry point |
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
component here, because a preset is a record on somebody's server. In the Box, `DataGrid`
draws the bar and the app passes its view store and `PresetPicker` in.

**Filters are typed fields.** The bar's spec lists `fields` (`@silkweave/box-ui/filters`), each with
a type that picks its editor and its matching rule: options (any of), person (people plus Me and
Nobody), date (relative windows such as Overdue or Next 7 days, a From/To range, or No date),
number (comparisons, between, empty, set), text (matches anywhere) and boolean. A stored value that
is absent or null is no filter. `value.pinned` names fields drawn as chips in the bar, each showing
its current value and opening its own editor; the panel's star toggles them (every `DataGrid`;
`BoardViewBar` alone with `pins`), which is how a preset carries the filters its team reaches for. Clear empties the filters and keeps the pins.

**`DataGrid` knows no domain.** The host passes the view (as for `BoardViewBar`; omitted, the grid
keeps it itself, per browser under `storageKey`) and accessors: `searchText`, `filterValue`, `sortValue`, `groupOf`, `parentId`,
`icon`, `rowLabel`, and the move rules `maxDepth`, `canNest` and `canMove`. Drag (and arrow keys on
the row's icon, which doubles as the handle) is offered under the manual sort, ungrouped and
unfiltered. While a row is dragged the list is drawn as it would be after the drop; releasing
commits exactly that. `onMove` gets the row, its new parent, the sibling it follows and the whole
depth-first `order`. A move shows at once: return a promise that settles once `rows` reflects it
(after the refetch, not the request) and the grid keeps drawing it until then. Moves made meanwhile
are handed over one at a time, each re-resolved and re-checked against the rows as they are by
then, so writes never race and a move that no longer fits reaches `onMoveError` as a
`MoveConflict` instead of being written. One instance shows one dataset: give it a React `key` per
dataset so pending moves never carry over.

A page whose top level has no order of its own (initiatives with their items) passes `arrangeTop`:
the view's sort, grouping, search and filters then arrange only the top-level rows, each bringing
its whole tree, and the rows below keep their plan order and stay draggable in every view, into
another top-level row's tree and across groups. Folding can be controlled (`expanded`,
`foldedGroups`) so a host keeps it per browser; `layouts` hands a layout the host draws itself (a
board, a timeline) the rows the view keeps, under the same bar; `freezeName` keeps the name column
in view while the list scrolls sideways.

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
