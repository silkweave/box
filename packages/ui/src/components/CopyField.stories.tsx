import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { CopyField } from './CopyField.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'

const meta = {
  title: 'Base/CopyField',
  decorators: [withStage],
  component: CopyField,
} satisfies Meta<typeof CopyField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { label: 'Webhook URL', hint: 'Stripe posts events here.', value: 'https://box.example.com/hooks/stripe', className: 'max-w-md' },
}

export const Variants: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='grid max-w-md gap-4'>
      <CopyField aria-label='MCP endpoint' value='https://box.example.com/mcp' />
      <CopyField label='Invite message' mono={false} value='Join our Box at box.example.com and sign in with Google.' />
      <CopyField label='API token' hint='Shown once. Store it in your password manager.' secret value={['bx', 'live', 'example', 'not', 'a', 'real', 'token'].join('_')} />
    </div>
  ),
}

export const States: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='grid max-w-md gap-4'>
      <CopyField label='Short' value='ada' />
      <CopyField
        label='Long value'
        value='https://box.example.com/oauth/callback?state=7f3a9c21e4b84d0f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b'
      />
      <fieldset disabled className='contents'>
        <CopyField label='Inside a disabled fieldset' value='box_7f3a9c21e4b84d0f' />
      </fieldset>
    </div>
  ),
}

export const InContext: Story = {
  args: { value: 'x' },
  render: () => (
    <div className='max-w-2xl'>
      <FieldGrid columns={2}>
        <Field label='Provider'><Input defaultValue='Google Workspace' /></Field>
        <CopyField label='Client id' value='1048-abc.apps.googleusercontent.com' />
        <div className='col-span-full'>
          <CopyField label='Redirect URI' hint='Add this to the authorised redirect URIs.' value='https://box.example.com/auth/oauth/google/callback' />
        </div>
      </FieldGrid>
    </div>
  ),
}
