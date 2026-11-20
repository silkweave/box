import type { Meta, StoryObj } from '@storybook/react-vite'
import { Globe, Search } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { CopyButton } from './CopyButton.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'

const meta = {
  title: 'Base/Input',
  decorators: [withStage],
  component: Input,
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { placeholder: 'Pipeline name', defaultValue: 'Q4 enterprise deals', className: 'max-w-sm' },
}

export const Sizes: Story = {
  render: () => (
    <div className='flex max-w-md flex-col gap-3'>
      <Input placeholder='md, for settings forms' />
      <Input size='sm' placeholder='sm, for toolbars and dense rows' />
      <Input size='sm' leading={<Search />} placeholder='Filter runs' />
    </div>
  ),
}

export const Variants: Story = {
  render: () => (
    <div className='flex max-w-md flex-col gap-3'>
      <Input mono defaultValue='sk_live_51NcV8tH2' aria-label='Key' />
      <Input leading={<Globe />} placeholder='example.com' aria-label='Domain' />
      <Input leading='https://' mono defaultValue='help.silkweave.dev' aria-label='Help center address' />
      <Input trailing='minutes' type='number' defaultValue={15} aria-label='Interval' />
      <Input mono readOnly value='https://box.example.com/hooks/stripe' trailing={<CopyButton value='https://box.example.com/hooks/stripe' />} aria-label='Webhook URL' />
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className='flex max-w-md flex-col gap-3'>
      <Input placeholder='Empty, with a placeholder' aria-label='Empty' />
      <Input disabled defaultValue='Disabled' aria-label='Disabled' />
      <Input readOnly value='Read-only' aria-label='Read-only' />
      <Input invalid defaultValue='not-an-email' aria-label='Invalid' />
      <Input invalid leading={<Globe />} defaultValue='http://insecure' aria-label='Invalid with slot' />
      <Input
        mono
        readOnly
        aria-label='Long value'
        value='https://box.example.com/oauth/callback?state=7f3a9c21e4b84d0f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d'
      />
    </div>
  ),
}

export const InContext: Story = {
  render: () => (
    <div className='max-w-2xl'>
      <FieldGrid columns={2}>
        <Field label='Mailbox name'><Input defaultValue='Support' /></Field>
        <Field label='Address' hint='Replies go out from this address.'><Input type='email' defaultValue='support@example.com' /></Field>
        <Field label='SMTP host' error='Could not reach smtp.example.com on port 587.' span='full'>
          <Input mono defaultValue='smtp.example.com' />
        </Field>
      </FieldGrid>
    </div>
  ),
}
