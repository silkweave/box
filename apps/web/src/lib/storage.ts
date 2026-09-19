import { storageKey } from '@silkweave/box-ui/lib'
import { APP_STORAGE_PREFIX } from './storagePrefix.ts'

/**
 * Every localStorage key this app owns, built from the one prefix in ./storagePrefix.ts.
 *
 * Until 2026-09-15 there were 35 `'silkweave.…'` literals across 20 files. They were left behind by
 * the 2026-09-14 de-branding of `packages/ui/src/lib/storage.ts`, which made the library's prefix a
 * parameter defaulting to `ui` - so a Box wrote its view state under one namespace and its shell
 * preferences under another, and nothing could see the split. **A key mismatch is invisible to
 * tsgo, to oxlint and to every test in this repo**: the same drift in one more place (`index.html`
 * reading `silkweave.theme` while `applyTheme()` wrote `ui.theme`) gave every dark-mode user a
 * light flash on every load, and only a human looking at the screen ever noticed.
 *
 * So: no call site spells a key out. `appKey('crm', 'collapsedGroups')`, never `'ui.crm...'`.
 */
export { APP_STORAGE_PREFIX }

export const appKey = (...parts: string[]): string => storageKey(APP_STORAGE_PREFIX, ...parts)

/** The theme pref. `index.html` needs this same string BEFORE any module loads - see vite.config.ts. */
export const APP_THEME_KEY = appKey('theme')
