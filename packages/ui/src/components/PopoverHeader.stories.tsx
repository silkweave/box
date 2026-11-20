import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'
import { PopoverHeader } from './PopoverHeader.tsx'

/**
 * `PopoverHeader` is the title bar of a tool popover (a grid's Filter and Columns): the name on the
 * left, the explanation behind the info icon's tooltip on the right. Opening the popover focuses its
 * first control, never the info icon, so the tooltip only shows when asked for.
 */
const meta = {
  title: 'Base/Popover header',
  component: PopoverHeader,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PopoverHeader>
export default meta
type Story = StoryObj<typeof meta>

export const InAPopover: Story = {
  args: { title: 'Columns', info: 'Account and Status are always shown. Drag to reorder.' },
  render: (args) => (
    <Popover>
      <PopoverTrigger render={<Button variant='outline' size='sm' />}>Columns</PopoverTrigger>
      <PopoverContent align='start' className='w-64 gap-0 p-0'>
        <PopoverHeader {...args} />
        <div className='flex flex-col gap-1 p-2 text-body-sm'>
          <Button variant='ghost' size='sm'>Contacts</Button>
          <Button variant='ghost' size='sm'>Next action</Button>
        </div>
      </PopoverContent>
    </Popover>
  ),
}
