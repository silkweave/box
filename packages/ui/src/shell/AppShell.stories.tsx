import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import { AppShell } from './AppShell.tsx'
import { ShellExtensionsProvider } from './ShellExtensions.tsx'
import { AccountMenu } from '../users/AccountMenu.tsx'
import { SAMPLE_GROUP_NAV, SAMPLE_NAV_ITEMS } from '../stories/fixtures.ts'

const meta = {
  title: 'Layout/AppShell',
  component: AppShell,
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

const Canvas = ({ title }: { title: string }) => (
  <div className='space-y-3 p-8'>
    <h1 className='text-heading-1 text-text'>{title}</h1>
    {Array.from({ length: 20 }, (_, i) => (
      <p key={i} className='text-body-sm text-muted-foreground'>
        Canvas line {i + 1}. The shell stays flat until an app extension opens a side panel.
      </p>
    ))}
  </div>
)

function Shell({ children, activeStart = 'overview' }: { children?: React.ReactNode; activeStart?: string }) {
  const [activeId, setActiveId] = useState(activeStart)
  const [activeGroup, setActiveGroup] = useState(SAMPLE_GROUP_NAV.activeGroup)
  return (
    <AppShell
      groupNav={{ ...SAMPLE_GROUP_NAV, activeGroup, onSelectGroup: setActiveGroup }}
      navigationKey={`${activeGroup}:${activeId}`}
      scrollResetKey={activeGroup}
      items={SAMPLE_NAV_ITEMS}
      activeId={activeId}
      onSelect={setActiveId}
      topbar={{ crumbs: [{ label: 'Signals' }, { label: 'Overview' }] }}>
      {children ?? <Canvas title='Signals' />}
    </AppShell>
  )
}

/**
 * With no provider at all. This is the story that matters most: the shell renders with an empty
 * `ShellExtensions` default, which is the proof that it carries no dependency on an agent stack, a
 * session or a feature registry.
 */
export const Bare: Story = { args: {} as never, render: () => <Shell /> }

/**
 * Change groups after scrolling the canvas. The same shell stays mounted while the navigation key
 * closes the mobile drawer and the section key returns the shell-owned main scroller to the top.
 */
export const PersistentNavigation: Story = { args: {} as never, render: () => <Shell /> }

/**
 * What an app actually hangs on it: a feature's bell, a user menu, an aside panel, and its
 * router's link for the wordmark (here a stand-in that only stops the document from reloading).
 */
export const WithExtensions: Story = {
  args: {} as never,
  render: () => (
    <ShellExtensionsProvider
      value={{
        asideOpen: true,
        homeLink: ({ children, onClick, ...rest }) => (
          <a href='/' {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e) }}>
            {children}
          </a>
        ),
        trailing: (
          <>
            <Button variant='ghost' size='icon-sm' aria-label='Notifications'>
              <Bell />
            </Button>
            <AccountMenu
              principal={{ id: 'ada', display: 'Ada Lovelace' }}
              onSignOut={() => {}}
              activeUserId='ada'
              onPickUser={() => {}}
            />
          </>
        ),
        aside: (
          <div className='w-80 shrink-0 border-l border-border bg-surface p-4'>
            <h2 className='text-heading-3 text-text'>Agent</h2>
            <p className='mt-2 text-body-sm text-muted-foreground'>
              An app's aside rides inside the framed canvas as a sibling of main.
            </p>
          </div>
        ),
      }}>
      <Shell />
    </ShellExtensionsProvider>
  ),
}

/** The aside has claimed the canvas: main goes inert but keeps its scroll position. */
export const MainInert: Story = {
  args: {} as never,
  render: () => (
    <ShellExtensionsProvider
      value={{
        asideOpen: true,
        mainInert: true,
        aside: (
          <div className='absolute inset-0 bg-surface p-6'>
            <h2 className='text-heading-3 text-text'>Agent, fullscreen</h2>
            <p className='mt-2 text-body-sm text-muted-foreground'>
              main is inert underneath - try to click or tab into it.
            </p>
          </div>
        ),
      }}>
      <Shell />
    </ShellExtensionsProvider>
  ),
}
