// The library's app-free utilities, published as `@silkweave/box-ui/lib`. Everything here is
// DOM-and-React only: no tRPC, no auth, no feature registry. `cn` in particular must exist exactly
// once in a running app - its tailwind-merge config is tied to the `@theme` font-size scale in
// ./styles/tokens.css, so a second copy would silently drop sizes. apps/web re-exports these from
// its own `@/lib/*` paths rather than keeping rival copies.
export { cn } from './utils.ts'
export { readStored, usePersistedState, writeStored } from './usePersistedState.ts'
export { applyTheme, getTheme, setTheme, toggleTheme, THEME_STORAGE_KEY, type Theme } from './theme.ts'
export { DEFAULT_STORAGE_PREFIX, storageKey } from './storage.ts'
export { SWATCHES, swatchClass, userSwatch, type Swatch } from './swatches.ts'
