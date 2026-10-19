/**
 * @silkweave/box-ui - the Box component library.
 *
 * Everything exported here renders with nothing but React and this package's own stylesheet in
 * scope: no tRPC client, no session, no feature registry, no agent host. That is the whole
 * contract. Where a component needs app data (a user directory, a document store), it declares the
 * narrowest shape it actually draws - see `AvatarUser` - or takes it through a provider the app
 * fills, never by importing the app. The app-free utilities are a second entry, `@silkweave/box-ui/lib`.
 *
 * The stylesheet is not imported from here (a library that injects global CSS on import cannot be
 * tree-shaken or overridden). An app imports it by path:
 *
 *     @import '@silkweave/box-ui/styles/globals.css';
 *
 * ENTRY POINTS ARE CUT BY DEPENDENCY FOOTPRINT, not by taxonomy. This one needs nothing but React,
 * base-ui, lucide and cva. Anything that needs more lives behind its own subpath and declares that
 * dependency as an OPTIONAL peer:
 *
 *     @silkweave/box-ui/board     + @dnd-kit/core, /sortable, /utilities
 *     @silkweave/box-ui/editor    + the eight TipTap packages
 *
 * The reason is mechanical, not aesthetic: this package has no build, so both consumers resolve the
 * `@silkweave/box-source` condition straight to `src/`. Whatever this barrel re-exports gets walked
 * by tsgo and by Vite's dependency scanner on every import of it - so a barrel that re-exported the
 * editor would make a Box that never opens one fail to resolve TipTap.
 *
 * A component without a story is not in the library.
 */

// Primitives.
export * from './components/inlineField.ts'
export * from './components/Avatar.tsx'
export * from './components/ActionListRow.tsx'
export * from './components/Autocomplete.tsx'
export * from './components/Badge.tsx'
export * from './components/Button.tsx'
export * from './components/Checkbox.tsx'
export * from './components/Confetti.tsx'
export * from './components/Confirm.tsx'
export * from './components/CopyLinkButton.tsx'
export * from './components/DateInput.tsx'
export * from './components/DateRangeInput.tsx'
export * from './components/Dialog.tsx'
export * from './components/Figures.tsx'
export * from './components/ImageGallery.tsx'
export * from './components/InlineEdit.tsx'
export * from './components/LogViewer.tsx'
export * from './components/NavAnchor.tsx'
export * from './components/Popover.tsx'
export * from './components/SearchInput.tsx'
export * from './components/SegmentedControl.tsx'
export * from './components/Select.tsx'
export * from './components/SelectField.tsx'
export * from './components/SplitPane.tsx'
export * from './components/TabNav.tsx'
export * from './components/TokenPicker.tsx'
export * from './components/UrlInput.tsx'

// The application shell: chrome that has no opinion about what a Box contains.
export * from './shell/AppShell.tsx'
export * from './shell/CenteredNote.tsx'
export * from './shell/CollapsibleSection.tsx'
export * from './shell/EmptyState.tsx'
export * from './shell/PageContainer.tsx'
export * from './shell/PageHeader.tsx'
export * from './shell/ShellExtensions.tsx'
export * from './shell/Sidebar.tsx'
export * from './shell/sidebarLayout.ts'
export * from './shell/ThemeToggle.tsx'
export * from './shell/TopBar.tsx'
export * from './shell/TopBarActions.tsx'

// Settings: the detail pane and the list, group, field and footer pieces every section is built from.
export * from './settings/SettingsPane.tsx'

// The data grid: the column model (order, widths, aggregates) and the two rows that frame a list -
// a sticky header you can drag the dividers of, and a sticky footer that totals what is on screen.
// Between them they are the geometry; the cells in between are the app's.
export * from './grid/columns.ts'
export * from './grid/GridHeader.tsx'
export * from './grid/GridFooter.tsx'

// The people in a Box: the directory seam the app fills, and what the library draws with it.
export * from './users/types.ts'
export * from './users/directory.tsx'
export * from './users/AccountMenu.tsx'
export * from './users/UserChip.tsx'
export * from './users/UserPicker.tsx'

// Icon machinery: a string-keyed glyph table with a fallback, plus the universal brand marks. A
// Box builds its OWN table from these - the vocabulary is the app's, the mechanism is ours.
export * from './icons/iconTable.tsx'

// Brand.
export * from './brand/Wordmark.tsx'
export * from './components/InlineDialog.tsx'
