import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Button } from './Button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'

const meta = {
  title: 'Base/Popover',
  decorators: [withStage],
  component: PopoverContent,
} satisfies Meta<typeof PopoverContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant='outline'>Open</Button>} />
      <PopoverContent className='w-56 p-2'>
        <p className='text-body-sm text-text'>Anything can live in here: a list, a form, a picker.</p>
      </PopoverContent>
    </Popover>
  ),
}

export const Alignment: Story = {
  render: () => (
    <div className='flex gap-2'>
      {(['start', 'center', 'end'] as const).map((align) => (
        <Popover key={align}>
          <PopoverTrigger render={<Button variant='outline' size='sm'>{align}</Button>} />
          <PopoverContent align={align} className='w-40 p-2'>
            <p className='text-body-sm text-text'>align={align}</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
}
