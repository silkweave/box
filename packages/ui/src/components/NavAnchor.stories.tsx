import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { NavAnchor } from './NavAnchor.tsx'

const meta = {
  title: 'Base/NavAnchor',
  decorators: [withStage],
  component: NavAnchor,
} satisfies Meta<typeof NavAnchor>

export default meta
type Story = StoryObj<typeof meta>

const linkCls = 'text-body-sm text-accent hover:underline'

function Demo({ children }: { children: (go: (to: string) => () => void) => ReactNode }) {
  const [last, setLast] = useState<string | null>(null)
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-4'>{children((to) => () => setLast(to))}</div>
      <p className='text-label text-muted-foreground'>
        {last ? `Client-side navigation to ${last}.` : 'A plain click navigates in place; Cmd/Ctrl, Shift or middle click opens a new tab.'}
      </p>
    </div>
  )
}

/** With an `href` it is a real `<a>`: a plain click runs `onClick` (the app's router), modified clicks are the browser's. */
export const Default: Story = {
  args: { href: '/settings/users', children: 'Users' },
  render: () => (
    <Demo>
      {(go) => (
        <>
          <NavAnchor href='/settings/users' onClick={go('/settings/users')} className={linkCls}>
            Users
          </NavAnchor>
          <NavAnchor href='/planning/initiatives' onClick={go('/planning/initiatives')} className={linkCls}>
            Initiatives
          </NavAnchor>
        </>
      )}
    </Demo>
  ),
}

/** Without an `href` it falls back to a `<button>` that runs `onClick`: an act that leads nowhere addressable. */
export const WithoutHref: Story = {
  args: { children: 'Show more' },
  render: () => (
    <Demo>
      {(go) => (
        <NavAnchor onClick={go('(no address)')} className={linkCls}>
          Show more
        </NavAnchor>
      )}
    </Demo>
  ),
}

/** With a `target` the handler never runs: the browser follows the link, here into a new tab. */
export const WithTarget: Story = {
  args: { href: 'https://example.com', target: '_blank', children: 'example.com' },
  render: () => (
    <Demo>
      {(go) => (
        <NavAnchor href='https://example.com' target='_blank' rel='noreferrer' onClick={go('never')} className={linkCls}>
          example.com (opens a new tab)
        </NavAnchor>
      )}
    </Demo>
  ),
}

/** In context: the crumb trail a top bar draws, each crumb a NavAnchor and the last one the current page. */
export const InContext: Story = {
  args: { href: '/settings', children: 'Settings' },
  render: () => (
    <Demo>
      {(go) => (
        <nav aria-label='Breadcrumb' className='flex items-center gap-1.5 text-body-sm text-muted-foreground'>
          <NavAnchor href='/settings' onClick={go('/settings')} className='hover:text-text'>
            Settings
          </NavAnchor>
          <span aria-hidden>›</span>
          <NavAnchor href='/settings/roles' onClick={go('/settings/roles')} className='hover:text-text'>
            Roles
          </NavAnchor>
          <span aria-hidden>›</span>
          <span aria-current='page' className='text-text'>
            Sales
          </span>
        </nav>
      )}
    </Demo>
  ),
}
