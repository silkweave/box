/**
 * Where the library's persisted UI preferences live.
 *
 * Until 2026-09-14 the four persisted keys here were hard-coded as `silkweave.sidebar.collapsed`,
 * `silkweave.sidebar.groupExpanded` and `silkweave.theme` - a component library stamping ONE
 * product's brand into every consumer's localStorage. A Box built for another team is not called
 * silkweave, and two Boxes served from one origin would have fought over the same keys.
 *
 * So the prefix is a parameter with a brand-neutral default, threaded as a prop (`AppShell`,
 * `Sidebar`) or an argument (`theme`) rather than held in module state. `SplitPane` already worked
 * this way - its `storageKey` is a required prop - and it is the pattern the rest now follows.
 */

/** Deliberately not a brand. A Box that wants its own namespace passes one. */
export const DEFAULT_STORAGE_PREFIX = 'ui'

export const storageKey = (prefix: string | undefined, ...parts: string[]): string =>
  [prefix ?? DEFAULT_STORAGE_PREFIX, ...parts].join('.')
