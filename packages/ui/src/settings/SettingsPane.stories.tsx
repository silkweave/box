import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { InlineDialog, InlineDialogContent, InlineDialogDescription, InlineDialogScope, InlineDialogTitle } from '../components/InlineDialog.tsx'
import {
  SettingsField,
  SettingsFooterBar,
  SettingsGroup,
  SettingsIntro,
  SettingsList,
  SettingsListHeading,
  SettingsListRow,
  SettingsPane,
  settingsInputCls,
  settingsRowActionCls,
  useSettingsFooter,
} from './SettingsPane.tsx'

const meta = {
  title: 'Settings/SettingsPane',
  component: SettingsPane,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsPane>

export default meta
type Story = StoryObj<typeof meta>

const PEOPLE = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', status: 'Active' },
  { id: 'alan', name: 'Alan Turing', email: 'alan@example.com', status: 'Invited' },
  { id: 'grace', name: 'Grace Hopper', email: '', status: 'Active' },
]
const ROW = 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_auto]'

function Editor({ person, onClose }: { person: (typeof PEOPLE)[number] | null; onClose: () => void }) {
  useSettingsFooter(
    (shadowed) => (
      <SettingsFooterBar shadowed={shadowed}>
        <Button variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
        <Button size='sm' onClick={onClose}>{person ? 'Save' : 'Create'}</Button>
      </SettingsFooterBar>
    ),
    [person],
  )
  return (
    <InlineDialog open onOpenChange={(o) => !o && onClose()}>
      <InlineDialogContent>
        <InlineDialogTitle>{person?.name ?? 'New person'}</InlineDialogTitle>
        <InlineDialogDescription>The editor takes the pane; its title is the breadcrumb.</InlineDialogDescription>
        <div className='grid gap-5 md:grid-cols-3'>
          <SettingsField label='Name'><input className={settingsInputCls} defaultValue={person?.name} /></SettingsField>
          <SettingsField label='Email' hint='No mail is sent.'><input className={settingsInputCls} defaultValue={person?.email} /></SettingsField>
          <SettingsField label='Handle'><input className={settingsInputCls} defaultValue={person?.id} /></SettingsField>
        </div>
        <SettingsGroup title='Notes' aside={<span className='text-label text-fg-4'>optional</span>}>
          <textarea className={settingsInputCls} rows={4} />
        </SettingsGroup>
      </InlineDialogContent>
    </InlineDialog>
  )
}

function Directory() {
  const [open, setOpen] = useState<string | null>(null)
  useSettingsFooter(
    open
      ? null
      : (shadowed) => (
          <SettingsFooterBar shadowed={shadowed}>
            <Button size='sm' onClick={() => setOpen('new')}><Plus /> New person</Button>
          </SettingsFooterBar>
        ),
    [],
  )
  return (
    <div className='pb-4'>
      <SettingsIntro>Everyone in the directory. Click a row to edit it.</SettingsIntro>
      <SettingsList label='People'>
        {PEOPLE.map((p) => (
          <SettingsListRow key={p.id} onOpen={() => setOpen(p.id)} label={`Edit ${p.name}`} className={ROW}>
            <div className='min-w-0'>
              <p className='truncate font-medium text-text'>{p.name}</p>
              <p className='truncate text-label text-muted-foreground'>@{p.id}</p>
            </div>
            <p className='hidden truncate text-body-sm text-muted-foreground md:block'>{p.email || 'No email'}</p>
            <div className='hidden md:block'><Badge variant={p.status === 'Active' ? 'success' : 'warning'}>{p.status}</Badge></div>
            <div className='flex justify-end gap-0.5'>
              <button type='button' aria-label='Delete' className={settingsRowActionCls} onClick={(e) => e.stopPropagation()}><Trash2 className='size-3.5' /></button>
              <button type='button' aria-label='More' className={settingsRowActionCls} onClick={(e) => e.stopPropagation()}><MoreHorizontal className='size-4' /></button>
            </div>
          </SettingsListRow>
        ))}
      </SettingsList>
      <SettingsListHeading title='Archived' />
      <SettingsList label='Archived'>
        <SettingsListRow className='grid-cols-1'><span className='text-body-sm text-muted-foreground'>Nobody archived.</span></SettingsListRow>
      </SettingsList>
      {open && <Editor person={PEOPLE.find((p) => p.id === open) ?? null} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** A list section with a footer action; a row opens a full-pane editor with a breadcrumb. */
export const ListAndEditor: Story = {
  args: { title: 'People', onClose: () => undefined, children: null },
  render: (args) => (
    <div className='h-[40rem] w-[52rem] border border-border'>
      <SettingsPane title={args.title} onClose={args.onClose}>
        <InlineDialogScope scroll={false}>
          <Directory />
        </InlineDialogScope>
      </SettingsPane>
    </div>
  ),
}
