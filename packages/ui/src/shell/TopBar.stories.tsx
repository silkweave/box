import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button.tsx'
import { TopBar } from './TopBar.tsx'

const meta = {
  title: 'Layout/TopBar',
  component: TopBar,
} satisfies Meta<typeof TopBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { content: { crumbs: [{ label: 'Signals' }, { label: 'Overview' }] } },
}

/** A crumb with a `menu` becomes a quick-switch dropdown - usually the last one. */
export const WithCrumbMenu: Story = {
  args: {
    content: {
      crumbs: [
        { label: 'Signals', onClick: () => {} },
        {
          label: 'GitHub',
          menu: [
            { label: 'GitHub', value: 'github', current: true, onSelect: () => {} },
            { label: 'npm', value: 'npm', onSelect: () => {} },
            { label: 'Reddit', value: 'reddit', onSelect: () => {} },
          ],
        },
      ],
    },
  },
}

/** `onRename` makes the crumb the record's name field: click to edit, commit on blur or Enter. */
export const RenameableCrumb: Story = {
  args: {
    content: {
      crumbs: [
        { label: 'Initiatives', onClick: () => {} },
        { label: 'Ship the UI package', onRename: () => {} },
      ],
    },
  },
}

export const WithActions: Story = {
  args: {
    content: {
      crumbs: [{ label: 'Initiatives' }],
      actions: <Button size='sm'>New initiative</Button>,
    },
    trailing: <Button variant='ghost' size='icon-sm' aria-label='Notifications'>3</Button>,
  },
}
