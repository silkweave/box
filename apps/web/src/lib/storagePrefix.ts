/**
 * This Box's localStorage namespace - the ONE place the prefix is written down.
 *
 * **This module imports nothing, on purpose.** `vite.config.ts` imports it to substitute the theme
 * key into `index.html`'s no-flash script (see the plugin there), and a vite config is loaded by
 * Node without this workspace's `@silkweave/box-source` condition - so a single import of
 * `@silkweave/box-ui` here would break the build. Keep it a bare constant.
 *
 * Two Boxes served from one origin fight over localStorage unless they differ here, which is the
 * reason `packages/ui` made its own prefix a parameter (`lib/storage.ts`, 2026-09-14) instead of
 * stamping a brand into every consumer. Change this value and EVERY key moves with it: the app's
 * own (via `appKey()`), the library's sidebar and theme keys (threaded as `storagePrefix` into
 * `AppShell`), and the pre-paint script in `index.html`. Nothing else may spell a key out.
 *
 * The cost of changing it is one-time and cosmetic: the previous namespace's column widths,
 * collapsed groups and recent-item lists are orphaned, and every view reopens at its default.
 */
export const APP_STORAGE_PREFIX = 'ui'
