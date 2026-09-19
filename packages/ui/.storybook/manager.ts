import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events'
import { addons } from 'storybook/manager-api'
import { MANAGER_THEMES, type ThemeName } from './theme.ts'

/**
 * Keeps the manager chrome on the same theme as the stories.
 *
 * The toolbar's `theme` global lives in the preview iframe; the manager is the
 * outer document and knows nothing about `<html data-theme>` in there. So we
 * listen for the global and (a) re-set the manager theme, (b) mirror the choice
 * onto the manager's own `<html data-sb-theme>` for the handful of surfaces
 * Storybook's theme API does not reach - see manager.css.
 */
function applyTheme(name: ThemeName) {
  addons.setConfig({ theme: MANAGER_THEMES[name] })
  document.documentElement.dataset.sbTheme = name
}

applyTheme('light')

addons.register('silkweave-box/theme', (api) => {
  const sync = (globals: Record<string, unknown> | undefined) => {
    const theme = globals?.theme
    if (theme === 'light' || theme === 'dark') applyTheme(theme)
  }

  sync(api.getGlobals?.())

  type GlobalsEvent = { globals?: Record<string, unknown>; userGlobals?: Record<string, unknown> }
  api.on(SET_GLOBALS, ({ globals, userGlobals }: GlobalsEvent) => sync(userGlobals ?? globals))
  api.on(GLOBALS_UPDATED, ({ globals, userGlobals }: GlobalsEvent) => sync(userGlobals ?? globals))
})
