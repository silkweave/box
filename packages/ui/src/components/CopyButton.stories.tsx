import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { CopyButton } from './CopyButton.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'

const meta = {
  title: 'Base/CopyButton',
  decorators: [withStage],
  component: CopyButton,
} satisfies Meta<typeof CopyButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { value: 'box_7f3a9c21e4b84d0f', label: 'Copy client id' },
}

export const Variants: Story = {
  args: { value: 'bunx box auth login ada' },
  render: () => (
    <div className='flex items-center gap-3'>
      <CopyButton value='bunx box auth login ada' label='Copy command' />
      <CopyButton variant='text' value='bunx box auth login ada' />
      <CopyButton variant='text' label='Copy command' value='bunx box auth login ada' />
    </div>
  ),
}

export const Sizes: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='flex items-center gap-3'>
      <CopyButton size='sm' value='sm' />
      <CopyButton size='md' value='md' />
      <CopyButton variant='text' size='sm' value='sm' />
      <CopyButton variant='text' size='md' value='md' />
    </div>
  ),
}

/** A function value is read at click time; one that throws shows "Copy failed". */
export const States: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='flex items-center gap-3'>
      <CopyButton variant='text' label='Copy now' value={() => new Date().toISOString()} />
      <CopyButton
        variant='text'
        label='Copy (fails)'
        value={() => {
          throw new Error('nothing to copy')
        }}
      />
    </div>
  ),
}

export const InContext: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='max-w-xl'>
      <FieldGrid columns={1}>
        <Field label='Redirect URI' hint='Paste this into the provider’s OAuth app.'>
          <Input mono readOnly value='https://box.example.com/auth/oauth/callback' trailing={<CopyButton value='https://box.example.com/auth/oauth/callback' />} />
        </Field>
      </FieldGrid>
    </div>
  ),
}
