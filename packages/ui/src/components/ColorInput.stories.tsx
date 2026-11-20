import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { ColorInput } from './ColorInput.tsx'
import { Field, FieldGrid } from './Field.tsx'

const meta = {
  title: 'Base/ColorInput',
  decorators: [withStage],
  component: ColorInput,
} satisfies Meta<typeof ColorInput>

export default meta
type Story = StoryObj

function Live({ initial, disabled }: { initial: string; disabled?: boolean }) {
  const [v, setV] = useState(initial)
  return <ColorInput value={v} onChange={setV} pickLabel='Pick the accent colour' disabled={disabled} />
}

/** In a Field: the label names the hex input, the swatch opens the system picker. */
export const Default: Story = {
  render: () => (
    <FieldGrid columns={2}>
      <Field label='Accent colour' hint='Links, buttons and the current page.'><Live initial='#3b82f6' /></Field>
    </FieldGrid>
  ),
}

/** States: an incomplete value keeps the fallback swatch; disabled for a member. */
export const States: Story = {
  render: () => (
    <FieldGrid columns={2}>
      <Field label='Typing' hint='Not a full hex value yet.'><Live initial='#3b8' /></Field>
      <Field label='Read only'><Live initial='#16a34a' disabled /></Field>
    </FieldGrid>
  ),
}
