import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FilterEditor } from './editors.tsx'
import { DUE_FIELD, ESTIMATE_FIELD, FLAG_FIELD, NOTE_FIELD, OWNER_FIELD, STATUS_FIELD, STORY_TODAY } from './fixtures.ts'
import type { FilterField, FilterValue } from './types.ts'

const meta = {
  title: 'Filters/Editors',
  component: FilterEditor,
} satisfies Meta<typeof FilterEditor>

export default meta
type Story = StoryObj<typeof meta>

/** One editor in a popover-sized box, with the value it writes underneath. */
function Frame({ field, start = null }: { field: FilterField; start?: FilterValue | null }) {
  const [value, setValue] = useState<FilterValue | null>(start)
  return (
    <div className='flex flex-col gap-3'>
      <div className='w-64 rounded-md bg-popover p-1.5 ring-1 ring-foreground/10'>
        <FilterEditor field={field} value={value} onChange={setValue} today={STORY_TODAY} />
      </div>
      <pre className='font-mono text-label text-muted-foreground'>{JSON.stringify(value)}</pre>
    </div>
  )
}

const args = { field: STATUS_FIELD, value: null, onChange: () => {} }

/** `options`: any of the values, a checklist. A list past eight entries gets a search box. */
export const Options: Story = { args, render: () => <Frame field={STATUS_FIELD} start={['active']} /> }

/** `person`: Me (whoever is looking) and the field's word for nobody first, then the people, with
 *  avatars where the app provides a user directory. Searchable past eight people. */
export const Person: Story = { args, render: () => <Frame field={OWNER_FIELD} start={['me']} /> }

/** `date`: one relative window (the field picks which make sense), or a range with either end open,
 *  or no date. Picking one replaces the others. */
export const DateWindows: Story = { args, render: () => <Frame field={DUE_FIELD} start={{ window: 'overdue' }} /> }

/** `number`: a comparison and its number, a range, or empty / has a value; the unit is the field's. */
export const NumberRange: Story = { args, render: () => <Frame field={ESTIMATE_FIELD} start={{ op: 'between', value: 2, to: 8 }} /> }

/** `text`: contains, any case, committed 200ms after the last keystroke. */
export const Text: Story = { args, render: () => <Frame field={NOTE_FIELD} /> }

/** `boolean`: Any, or the field's own words for on and off. */
export const OnOff: Story = { args, render: () => <Frame field={FLAG_FIELD} start={true} /> }
