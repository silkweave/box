import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook is the library's only consumer that is not an app, which is the point: if a component
 * cannot be rendered here, with no tRPC client, no session and no feature registry in scope, then
 * it is not a Box UI component and belongs in apps/web. The house rule follows from that - a
 * component without a story is not in the library.
 */

/**
 * The manager is a plain document: it never loads the library's stylesheet, so the `fontBase` /
 * `fontCode` in theme.ts would fall back to system-ui without these @font-face rules. The files
 * come from the same @fontsource packages the preview bundles (see src/styles/fonts.css), served
 * out of `staticDirs` below - still no Google Fonts CDN at runtime.
 */
const fontFace = (family: string, dir: string, file: string, weight: number) => `
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('/fonts/${dir}/${file}-latin-${weight}-normal.woff2') format('woff2');
}`

const managerFonts = [
  ...[400, 500, 600, 700].map((w) => fontFace('Inter', 'inter', 'inter', w)),
  ...[400, 500].map((w) => fontFace('JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono', w)),
].join('\n')

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],

  // No `@storybook/addon-docs`, and so no autodocs "Docs" page per component. Nobody - human or
  // agent - reads a generated prose page for a Button; the stories ARE the documentation, and a
  // Docs entry beside every component only doubles the sidebar and buries them. The Foundations
  // pages cover everything that genuinely needs prose, and they are ordinary stories.
  addons: ['@storybook/addon-a11y'],

  // Still worth it without the docs addon: docgen is what fills the Controls panel with real prop
  // types and their TSDoc, which is how a story becomes explorable rather than just a screenshot.
  typescript: { reactDocgen: 'react-docgen-typescript' },

  // Our own chrome, our own fonts. Same no-phone-home posture as the self-hosted fonts
  // (src/styles/fonts.css): nothing here fetches from a CDN at runtime.
  staticDirs: [
    '../public',
    { from: '../node_modules/@fontsource/inter/files', to: '/fonts/inter' },
    { from: '../node_modules/@fontsource/jetbrains-mono/files', to: '/fonts/jetbrains-mono' },
  ],
  // `public/manager.css` is LINKED, not inlined: Storybook caches the manager's generated
  // index.html, so an inlined stylesheet would go stale until the cache is wiped.
  managerHead: (head) =>
    `${head}<style>${managerFonts}</style><link rel="stylesheet" href="/manager.css" />`,

  core: {
    disableTelemetry: true,
    // Stock Storybook chrome we do not want in a branded design system: the "What's new"
    // release feed and its notification dot, and the crash reporter's prompt.
    disableWhatsNewNotifications: true,
    enableCrashReports: false,
  },
  features: {
    // The "Configure your project" onboarding checklist that Storybook pins to the sidebar.
    sidebarOnboardingChecklist: false,
  },
}

export default config
