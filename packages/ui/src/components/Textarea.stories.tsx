import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'
import { Textarea } from './Textarea.tsx'

const meta = {
  title: 'Base/Textarea',
  decorators: [withStage],
  component: Textarea,
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    'aria-label': 'Description',
    'className': 'max-w-md',
    'defaultValue': 'Weekly pulls from GitHub, npm and X, rolled into one digest for the Monday review.',
  },
}

/** Type past the third line: it grows, then scrolls at `maxRows`. */
export const AutoGrow: Story = {
  render: () => (
    <div className='grid max-w-md gap-3'>
      <Textarea autoGrow aria-label='Notes' placeholder='Grows without limit' />
      <Textarea autoGrow maxRows={6} aria-label='Prompt' defaultValue={'You draft replies for the support inbox.\nKeep them short.\nLink the help center article when one fits.'} />
    </div>
  ),
}

export const Mono: Story = {
  render: () => (
    <Textarea
      mono
      rows={6}
      aria-label='Headers'
      className='max-w-md'
      defaultValue={'{\n  "Authorization": "Bearer <token>",\n  "X-Box-Source": "stripe"\n}'}
    />
  ),
}

export const States: Story = {
  render: () => (
    <div className='grid max-w-md gap-3'>
      <Textarea aria-label='Empty' placeholder='Empty, with a placeholder' />
      <Textarea aria-label='Disabled' disabled defaultValue='Disabled' />
      <Textarea aria-label='Read-only' readOnly value='Read-only: synced from the provider.' />
      <Textarea aria-label='Invalid' invalid defaultValue='{ "broken": ' mono />
    </div>
  ),
}

export const InContext: Story = {
  render: () => (
    <div className='max-w-2xl'>
      <FieldGrid columns={2}>
        <Field label='Topic'><Input defaultValue='Launch week' /></Field>
        <Field label='Channel'><Input defaultValue='LinkedIn' /></Field>
        <Field label='Brief' hint='Two or three sentences: the angle and who it is for.' span='full'>
          <Textarea autoGrow maxRows={8} defaultValue='Why a Box beats a pile of SaaS tabs for a five-person team.' />
        </Field>
      </FieldGrid>
    </div>
  ),
}
