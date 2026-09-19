import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { TokenPicker, lowercaseUniqueSorted } from './TokenPicker.tsx'
import { SAMPLE_TAGS } from '../stories/fixtures.ts'

const meta = {
  title: 'Base/TokenPicker',
  decorators: [withStage],
  component: TokenPicker,
} satisfies Meta<typeof TokenPicker>

export default meta
type Story = StoryObj<typeof meta>

function Controlled({ initial, ...rest }: { initial: string[] } & Partial<Parameters<typeof TokenPicker>[0]>) {
  const [value, setValue] = useState(initial)
  return (
    <div className='w-80'>
      <TokenPicker options={SAMPLE_TAGS} {...rest} value={value} onChange={setValue} />
    </div>
  )
}

/** As a tag picker: free vocabulary, so it normalizes and creates on Enter. */
export const Tags: Story = {
  args: { value: ['launch', 'mcp'], options: SAMPLE_TAGS, onChange: () => {} },
  render: () => (
    <Controlled
      initial={['launch', 'mcp']}
      placeholder='add a tag…'
      emptyLabel='No tags yet.'
      normalize={lowercaseUniqueSorted}
    />
  ),
}

export const Empty: Story = {
  args: { value: [], options: SAMPLE_TAGS, onChange: () => {} },
  render: () => <Controlled initial={[]} placeholder='add a tag…' emptyLabel='No tags yet.' normalize={lowercaseUniqueSorted} />,
}

/**
 * A CLOSED vocabulary: `allowCreate={false}` and no normalize, so the caller's ids survive intact.
 * This is the case that the old `TagPicker` could not express - it lowercased everything on the way
 * out, which is right for tags and wrong for anything with an identity.
 */
export const ClosedVocabulary: Story = {
  args: { value: ['initiative-42'], options: [], onChange: () => {} },
  render: () => (
    <Controlled
      initial={['initiative-42']}
      options={['initiative-42', 'initiative-7', 'SIGNAL-Stars', 'SIGNAL-Forks']}
      allowCreate={false}
      placeholder='add a dependency…'
      emptyLabel='Nothing left to depend on.'
    />
  ),
}
