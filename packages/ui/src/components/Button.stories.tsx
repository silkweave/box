import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { Eye, EyeOff, Pin, Plus, Trash2 } from 'lucide-react'
import { Button } from './Button.tsx'

const meta = {
  title: 'Base/Button',
  decorators: [withStage],
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] },
    size: { control: 'select', options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: 'Save' } }

/** Every variant side by side. `default` is the only one carrying the indigo glow - at most one per surface. */
export const Variants: Story = {
  args: { children: 'Button' },
  render: (args) => (
    <div className='flex flex-wrap items-center gap-2'>
      <Button {...args} variant='default'>Default</Button>
      <Button {...args} variant='outline'>Outline</Button>
      <Button {...args} variant='secondary'>Secondary</Button>
      <Button {...args} variant='ghost'>Ghost</Button>
      <Button {...args} variant='destructive'>Destructive</Button>
      <Button {...args} variant='link'>Link</Button>
    </div>
  ),
}

export const Sizes: Story = {
  args: { children: 'Button' },
  render: (args) => (
    <div className='flex flex-wrap items-center gap-2'>
      <Button {...args} size='xs'>xs</Button>
      <Button {...args} size='sm'>sm</Button>
      <Button {...args} size='default'>default</Button>
      <Button {...args} size='lg'>lg</Button>
    </div>
  ),
}

/** Icon sizes are square: the glyph IS the hit target, so they need no label. */
export const IconOnly: Story = {
  args: { children: null },
  render: () => (
    <div className='flex flex-wrap items-center gap-2'>
      <Button size='icon-xs' aria-label='Add'><Plus /></Button>
      <Button size='icon-sm' variant='outline' aria-label='Add'><Plus /></Button>
      <Button size='icon' variant='ghost' aria-label='Delete'><Trash2 /></Button>
    </div>
  ),
}

export const Disabled: Story = { args: { children: 'Save', disabled: true } }

/**
 * A two-state button is this component with `aria-pressed` - there is no Toggle component, and
 * there should not be one. `ghost` tints the glyph; `outline` tints the glyph and the border.
 *
 * Note what the button does NOT do: it has no opinion about what pressed MEANS, it does not build
 * its own label, and it does not hide itself when pressing it would be pointless. Those are the
 * caller's, every time.
 */
export const Pressed: Story = {
  args: { children: null },
  render: () => {
    const [shown, setShown] = useState(true)
    const [pinned, setPinned] = useState(false)
    const label = shown ? 'Hide done items' : 'Show done items'
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-pressed={shown}
          aria-label={label}
          title={label}
          onClick={() => setShown((v) => !v)}>
          {shown ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          variant='outline'
          size='icon-sm'
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin' : 'Pin'}
          onClick={() => setPinned((v) => !v)}>
          <Pin />
        </Button>
        <Button variant='outline' aria-pressed={pinned} onClick={() => setPinned((v) => !v)}>
          {pinned ? 'Pinned' : 'Pin'}
        </Button>
      </div>
    )
  },
}
