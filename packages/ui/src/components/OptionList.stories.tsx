import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { OptionList } from './OptionList.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'
import { Button } from './Button.tsx'

/**
 * `OptionList` is the list inside a picker's popover. Short lists are read; past five options a
 * search box appears and takes focus. The height is capped, so a long list scrolls instead of
 * running off the screen. `UserPicker`, `SelectField` and `SelectCell` use it.
 */
const meta = {
  title: 'Base/Option list',
  component: OptionList,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OptionList>
export default meta
type Story = StoryObj<typeof meta>

const NAMES = ['Ana Petrova', 'Ben Carter', 'Daniel Ruiz', 'Felix Wagner', 'Grace Lee', 'Leah Brooks', 'Marta Kowalska', 'Omar Haddad', 'Priya Raman', 'Sofia Marchetti', 'Tomasz Wójcik', 'Yusuf Demir']

function Demo({ count }: { count: number }) {
  const [value, setValue] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const items = NAMES.slice(0, count).map((n) => ({ value: n, label: n }))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='outline' size='sm' />}>{value ?? `Pick one of ${count}`}</PopoverTrigger>
      <PopoverContent align='start' className='w-60 gap-1 p-1'>
        <OptionList items={items} value={value} onPick={(v) => { setValue(v); setOpen(false) }} />
      </PopoverContent>
    </Popover>
  )
}

export const Short: Story = { args: { items: [], value: null, onPick: () => {} }, render: () => <Demo count={4} /> }
export const Searchable: Story = { args: { items: [], value: null, onPick: () => {} }, render: () => <Demo count={12} /> }
