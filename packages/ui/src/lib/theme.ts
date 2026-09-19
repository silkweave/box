/**
 * Theme module - light/dark only (no `system` mode). On first launch (nothing
 * persisted) the theme is seeded from the OS preference and stored, so the toggle
 * always has a definite state. Switching flips a single `data-theme` attribute on
 * <html>; the only persisted state is the pref in localStorage, under `THEME_STORAGE_KEY` by
 * default. Every function takes the key as an optional argument so a Box can namespace it - see
 * ./storage.ts for why the library no longer hard-codes a brand into it.
 */

import { DEFAULT_STORAGE_PREFIX, storageKey } from './storage.ts'

export type Theme = 'light' | 'dark'

/** `ui.theme`. Pass your own to `getTheme`/`setTheme`/`applyTheme`/`toggleTheme` to change it. */
export const THEME_STORAGE_KEY = storageKey(DEFAULT_STORAGE_PREFIX, 'theme')

const VALID: ReadonlySet<string> = new Set(['light', 'dark'])

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** Read the stored theme; on first launch seed from the OS preference and persist it. */
export function getTheme(key: string = THEME_STORAGE_KEY): Theme {
  try {
    const raw = localStorage.getItem(key)
    if (raw && VALID.has(raw)) return raw as Theme
  } catch {
    /* storage unavailable → fall through to OS default */
  }
  const initial: Theme = prefersDark() ? 'dark' : 'light'
  try {
    localStorage.setItem(key, initial)
  } catch {
    /* ignore persistence failures */
  }
  return initial
}

/** Apply a theme to <html data-theme>. Pure DOM write, no re-render. */
export function applyTheme(theme: Theme = getTheme()): Theme {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  return theme
}

/** Persist + apply a theme preference. */
export function setTheme(theme: Theme, key: string = THEME_STORAGE_KEY): Theme {
  try {
    localStorage.setItem(key, theme)
  } catch {
    /* ignore persistence failures */
  }
  return applyTheme(theme)
}

/** Flip light↔dark, persist, and apply. Returns the new theme. */
export function toggleTheme(current: Theme, key: string = THEME_STORAGE_KEY): Theme {
  return setTheme(current === 'dark' ? 'light' : 'dark', key)
}
