---
name: ui
description: Build or change any page, Settings section, dialog or form of a Box the way the design system says. Use before writing or editing web UI (apps/web, features/*/web, packages/ui), when adding a settings section or a detail, create or tabbed page, when a page needs inputs, lists, copy buttons, status, loading or error states, or when someone asks how a page should look or behave.
---

# Build Box UI

The full guide is `docs/DESIGN.md`. This skill is the part to hold in mind while building; read
the guide for anything these rules do not settle.

## Before you start

1. Decide the page's tasks before copying anything: parts read together are one page with
   sections; different jobs at different moments are tabs (one level); parts with their own
   lifecycle are sibling routes (`docs/DESIGN.md` 2.2). Name the frame (a Settings section, or an
   app page) and the archetype of each page. Then name each concept you draw (a list of records, a
   person, a status) and find its one kit piece (`docs/DESIGN.md` 1.5).
2. Open the matching boilerplate in `packages/ui/src/stories/patterns/` and copy it:
   `ListView.stories.tsx` (a routed app page of records in the `AppShell`),
   `SettingsList.stories.tsx` (Settings list, grouped, editable in place, member view),
   `SettingsDetail` (a detail with tabs: a child list with its own create, a form with Delete and
   Save, a log), `SettingsTabbed` (list, form and log tabs), `SettingsCreate`, `SettingsForm`,
   `SettingsOverview`, `SettingsLog`; `AppRecord.stories.tsx` (an app create dialog and a record's
   own page). Copy an in-app example only if it already
   follows the guide (Users, Roles, Profile).
3. Check `packages/ui/README.md` "Choosing a component" before writing any markup that draws a
   control, a row, a header, a state or a copy button.

## Hard rules

0. Every list of records is a `DataGrid` (`@silkweave/box-ui/list`), on app pages and in Settings
   alike: rows open with `onOpen`, actions in `rowActions`, in-place editing with `editing` where a
   record fits a row. The name column is a `NameCell` (name, second line, mark, one compact badge),
   or a `TitleCell` where the title can be renamed. Every settable column edits in its cell with the
   kit cells (`SelectCell`, `DateCell`, `TagsCell`, `UserPicker`); derived values stay read-only.
   A page's or tab's own list is a plain grid without a title. Never write list, group-row or
   table markup. Pass content to kit pieces; do
   not restyle them with classes (placement such as `truncate` or `shrink-0` is fine). If a piece
   cannot do what the page needs, the piece gets the option, not the page a copy.

1. Compose from `@silkweave/box-ui`. No raw `<input>`, `<textarea>`, `<select>`, `<table>`,
   clipboard call or private input class in app or feature code. Reason: 169 raw inputs once
   drifted into 23 private styles.
2. Every page and dialog that can be opened has a route (`#settings/<section>/<id>`, `/<tab>`,
   `/crm#new`). Local state never decides which page shows: a reload or a shared link must land
   on the same page.
3. One act, one place: create in the title bar (`SettingsHeaderActions`, at most two; app pages
   `TopBarActions`), Save in the footer (`SettingsSaveBar`, label `Save`), Delete in a Settings
   detail's footer (`SettingsDeleteButton`) or on an app record's page in the top bar (a labelled
   outline button, rule 7), and optionally in the row's "..." menu. No bare trash icon, no
   second Save on a page. The open layer owns the bar and footer: render them in the page or tab
   that owns the act (a detail's child list puts Add in the title bar, never in the body).
4. Explanations go in the info popover (`SettingsIntro`, `SettingsPage info`), never as a sentence
   on the canvas.
5. Sections never add `SETTINGS_GUTTER` or top padding: the kit pieces own spacing. Layout answers
   the container, not the window: no `sm:`/`md:` grids inside panes; the top bar overflows its
   acts by itself.
6. Member view: wrap the canvas (inside the tab panel) in `SettingsReadOnly` with one sentence on
   who can change it. `Field` and `SettingsControlRow` controls disable themselves and save,
   create and delete pieces leave; settings menus keep only items marked `reader`; search,
   filters, opening rows and copy stay live. A loose write
   control checks `useSettingsReadOnly()`. Never offer an action the server refuses; never show a
   raw server error.
7. App create forms are a `RecordDialog` over the list, opened by the URL hash (`/crm#new`,
   `useHashDialog('new')`), with a `SettingsSaveBar` (`Patterns/App record`); a record's settings
   form is a `RecordDialog` over the record. A record's own page is a `RecordPage` whose fields
   save as they change, state and Delete in the top bar. A write with nowhere else to report
   fails through `notifyError`, warnings to read first through `notice`, an autosaving document
   shows `SaveStatus`; never `window.alert`.
8. Loading, error and empty come from the kit (a list's `loading`, `error`, `empty`; elsewhere
   `SettingsLoading`, `SettingsError` with `errorMessage`, `SettingsEmpty`), never a hand-written
   paragraph.
9. `Switch` for a state that takes effect (enabled, armed); `Checkbox` for picking items;
   `SelectField` for a closed set.
10. Copy: sentence case; `New thing` for what the Box owns, `Add thing` for what is connected;
   empty states name the action, never a position ("below"); no configuration keys or server
   messages outside a `code` element naming the file; no em dashes.
11. In the Stack, a missing reusable piece goes into `packages/ui` with a doc comment and a story
    (two users or a clear core role). The story renders the production piece, one fixture per
    branch that changes what it draws, and a spec in `packages/ui/test/rendered/` measures it and
    drives its interactions; run `bun run --filter @silkweave/box-ui test:rendered`. In a Box, keep the one-off piece inside the feature and name
    the missing kit piece in your handoff: core, and the kit with it, is replaced on upgrade.

## Look at it

Load every changed page in a browser, light and dark, as an administrator and as a member. In
Builder use `box builder browser --session <id> screenshot`; in the Stack use Shuttle against
`box dev`. Typechecking does not catch layout, spacing or a missing state. A changed kit piece
also passes its rendered specs. Compare the changed region with the same region of its sibling
pages at the same scale, and name what you did not check (a theme, a role, a width) instead of
calling the change checked.

## Checklist for the handoff

- Concept named for each repeated thing, drawn with its one kit piece.
- Archetype per page; every page routed.
- Create in the title bar; one Save in the footer; Delete in the Settings detail footer or the
  app record's top bar, never both.
- Member view checked.
- Loading, empty and error states present.
- No raw input, textarea, select, table or clipboard call.
- Copy rules followed.
- Screenshots: light, dark, admin, member.
- Kit change: a story of the production piece per branch, its rendered specs passing.
- What was not checked, named.
