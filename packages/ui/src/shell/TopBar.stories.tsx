import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import { SegmentedControl } from '../components/SegmentedControl.tsx'
import { SelectField } from '../components/SelectField.tsx'
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
    trailing: <Button variant='ghost' size='icon-sm' aria-label='3 notifications'>3</Button>,
  },
}

// A sprint-like bar: crumbs, a centred view switcher, two acts and a status, the shell's controls.
function Crowded({ width }: { width: number }) {
  const [center, setCenter] = useState<HTMLDivElement | null>(null)
  const [view, setView] = useState('planning')
  const [state, setState] = useState('active')
  return (
    <div style={{ width }} className='border border-border'>
      <TopBar
        content={{
          crumbs: [{ label: 'Sprints', onClick: () => undefined }, { label: 'Sprint 23: onboarding polish and pricing' }],
          actions: (
            <>
              <Button size='sm'>New task</Button>
              <div className='w-32'>
                <SelectField aria-label='Status' value={state} onValueChange={setState} options={[{ value: 'active', label: 'Active' }, { value: 'done', label: 'Done' }]} />
              </div>
              <Button size='sm' variant='outline'>Close sprint</Button>
            </>
          ),
        }}
        centerSlotRef={setCenter}
        trailing={
          <>
            <Button variant='ghost' size='icon-sm' aria-label='Notifications'><Bell /></Button>
            <Button size='sm' variant='outline'>Work</Button>
          </>
        }
      />
      {center && createPortal(<SegmentedControl aria-label='View' value={view} onChange={setView} options={[{ value: 'planning', label: 'Planning' }, { value: 'board', label: 'Board' }]} />, center)}
    </div>
  )
}

/** Room for everything: the switcher centred, acts inline. */
export const CrowdedWide: Story = { args: {}, render: () => <Crowded width={1180} /> }

/** Narrow (a 820px window with the sidebar): acts behind More actions; the switcher joins the row
 *  when it would collide, so no control covers another. */
export const CrowdedNarrow: Story = { args: {}, render: () => <Crowded width={563} /> }
