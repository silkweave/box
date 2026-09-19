import type { Decorator, Preview } from '@storybook/react-vite'
import * as React from 'react'
import { ConfirmHost } from '../src/components/Confirm.tsx'
import { UsersProvider } from '../src/users/directory.tsx'
import { SAMPLE_USERS } from '../src/stories/fixtures.ts'
import './preview.css'

// Light and dark are one token swap on <html data-theme> (see src/styles/tokens.css), so the
// toolbar toggle writes the attribute rather than re-rendering anything. Same mechanism the real
// app uses, which is what makes "it looked right in Storybook" mean something.
//
// This wrapper contributes the canvas colour and a full-height box, and NOTHING else - no padding.
// Storybook does not get to dictate spacing: AppShell, Sidebar, TopBar and the editor all claim the
// full area, and a story that would otherwise hug the edge opts into the gutter with
// `decorators: [withStage]` (src/stories/Stage.tsx).
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light'
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  return (
    <div className="min-h-screen bg-bg text-text">
      <Story />
    </div>
  )
}

// The directory seam, filled with fixtures: every avatar, owner chip and picker in the library
// reads it, so a story never has to set one up. A story that wants a different directory (empty,
// not-loaded) wraps itself in its own UsersProvider, which wins as the nearer provider.
const withUsers: Decorator = (Story) => (
  <UsersProvider users={SAMPLE_USERS}>
    <Story />
  </UsersProvider>
)

// `confirm()` resolves against whichever host is mounted, so one here makes it work in every story.
const withConfirmHost: Decorator = (Story) => (
  <>
    <Story />
    <ConfirmHost />
  </>
)

const preview: Preview = {
  decorators: [withConfirmHost, withUsers, withTheme],
  globalTypes: {
    theme: {
      description: 'Design-token theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // Fullscreen by DEFAULT, not per story. Storybook's stock 'padded' layout injects a 1rem
    // gutter of its own, which is exactly the dictated spacing we are getting rid of; every story
    // that wanted the full area used to have to opt out of it one at a time.
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
    options: {
      // The sidebar reads top-down as the library is meant to be learned: the token system, then
      // the mark, then the scaffolding, then the unopinionated primitives, then the namespaces
      // that carry a seam of their own. Anything not listed sorts alphabetically after these.
      storySort: {
        // Alphabetical WITHIN each namespace; `order` only fixes the top level (and the
        // Foundations pages, which read in a deliberate sequence rather than by name).
        method: 'alphabetical',
        order: [
          'Foundations',
          ['Welcome', 'Colors', 'Typography', 'Spacing', 'Radii', 'Shadows', 'Motion', 'Iconography'],
          'Brand',
          'Layout',
          'Base',
          'Board',
          'Charts',
          'Grid',
          'Users',
          'Editor',
          'Ops',
          '*',
        ],
      },
    },
  },
}

export default preview
