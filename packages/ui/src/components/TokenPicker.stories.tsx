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
      <TokenPicker aria-label='Tags' options={SAMPLE_TAGS} {...rest} value={value} onChange={setValue} />
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

/**
 * Records picked by name: `TokenOption`s keep the id as the value and show the label in the list,
 * the chips and the search. A value no option names (a deleted record) shows as its id.
 */
export const Labelled: Story = {
  args: { value: ['mrr'], options: [], onChange: () => {} },
  render: () => (
    <Controlled
      initial={['mrr', 'retired-signal']}
      aria-label='Drivers'
      options={[
        { value: 'mrr', label: 'Monthly recurring revenue' },
        { value: 'signups', label: 'Signups' },
        { value: 'trial-conversion', label: 'Trial conversion' },
        { value: 'churned-customers', label: 'Churned customers' },
      ]}
      allowCreate={false}
      placeholder='add a signal…'
      emptyLabel='No signal matches.'
    />
  ),
}
