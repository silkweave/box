import { create } from 'storybook/theming'

/**
 * The Storybook manager's theme - the chrome around the stories.
 *
 * Storybook's theme API wants literal colors, so these are LITERAL MIRRORS of
 * `src/styles/tokens.css`, not `var()` references: the manager is a separate
 * document from the preview iframe and never loads the library's stylesheet.
 * Keep the two in step - every value below is copied from the matching
 * `:root`/`[data-theme='dark']` block, and the name of the token it mirrors is
 * in the comment beside it.
 *
 * The wordmark is HTML rather than an image: with `brandImage: null` Storybook
 * renders `brandTitle` as raw HTML (see `.storybook/manager.css` for its
 * styling), which lets the mark and the "silkweave box" lockup pick up the
 * manager's own font and theme instead of being baked into a bitmap.
 */

const brandTitle = `
  <img src="/silkweave-mark.svg" alt="" width="22" height="22" />
  <span class="sw-wordmark">silkweave<b>box</b></span>
`

const shared = {
  brandTitle,
  brandUrl: './',
  brandTarget: '_self' as const,
  brandImage: null,
  appBorderRadius: 10,
  inputBorderRadius: 6,
  fontBase: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontCode: "'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace",
}

export const boxLight = create({
  ...shared,
  base: 'light',

  colorPrimary: '#5558e6', // --accent
  colorSecondary: '#5558e6', // --accent (drives the selected/hover bar color)

  appBg: '#ffffff', // --bg
  appContentBg: '#ffffff', // --bg
  appPreviewBg: '#ffffff', // --bg
  appBorderColor: '#e8e8ec', // --border

  textColor: '#0e0e16', // --fg-1
  textInverseColor: '#ffffff', // --accent-fg
  textMutedColor: '#6b6b7a', // --fg-3

  barBg: '#ffffff', // --bg
  barTextColor: '#41414f', // --fg-2
  barSelectedColor: '#5558e6', // --accent
  barHoverColor: '#5558e6', // --accent

  inputBg: '#ffffff', // --bg
  inputBorder: '#e8e8ec', // --border
  inputTextColor: '#0e0e16', // --fg-1

  booleanBg: '#fafafa', // --bg-surface
  booleanSelectedBg: '#ffffff', // --bg
  buttonBg: '#fafafa', // --bg-surface
  buttonBorder: '#e8e8ec', // --border
})

export const boxDark = create({
  ...shared,
  base: 'dark',

  colorPrimary: '#7b7ef5', // --accent
  colorSecondary: '#7b7ef5', // --accent

  appBg: '#0a0a0f', // --bg
  appContentBg: '#0a0a0f', // --bg
  appPreviewBg: '#0a0a0f', // --bg
  appBorderColor: '#1e1e2e', // --border

  textColor: '#e4e4ef', // --fg-1
  textInverseColor: '#0a0a0f', // --bg
  textMutedColor: '#8888a0', // --fg-3

  barBg: '#0a0a0f', // --bg
  barTextColor: '#b8b8cc', // --fg-2
  barSelectedColor: '#7b7ef5', // --accent
  barHoverColor: '#9ba0f8', // --accent-hover

  inputBg: '#12121a', // --bg-surface
  inputBorder: '#1e1e2e', // --border
  inputTextColor: '#e4e4ef', // --fg-1

  booleanBg: '#12121a', // --bg-surface
  booleanSelectedBg: '#1a1a26', // --bg-surface-hover
  buttonBg: '#12121a', // --bg-surface
  buttonBorder: '#1e1e2e', // --border
})

export const MANAGER_THEMES = { light: boxLight, dark: boxDark }
export type ThemeName = keyof typeof MANAGER_THEMES

export default boxLight
