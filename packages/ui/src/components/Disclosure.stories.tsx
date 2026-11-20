import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { Disclosure } from './Disclosure.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'

const meta = {
  title: 'Base/Disclosure',
  decorators: [withStage],
  component: Disclosure,
} satisfies Meta<typeof Disclosure>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'Advanced',
    children: <p className='max-w-md text-body-sm text-muted-foreground'>Timeouts, retries and the headers sent with every call.</p>,
  },
}

export const Variants: Story = {
  args: { title: 'Advanced', children: null },
  render: function Variants() {
    const [open, setOpen] = useState(true)
    return (
      <div className='grid max-w-md gap-4'>
        <Disclosure title='Starts open' defaultOpen>
          <p className='text-body-sm text-muted-foreground'>Uncontrolled, with defaultOpen.</p>
        </Disclosure>
        <Disclosure title={`Controlled (${open ? 'open' : 'closed'})`} open={open} onOpenChange={setOpen}>
          <p className='text-body-sm text-muted-foreground'>The parent owns the state.</p>
        </Disclosure>
      </div>
    )
  },
}

export const States: Story = {
  args: { title: 'Advanced', children: null },
  render: () => (
    <div className='grid max-w-md gap-4'>
      <Disclosure title='Closed'>
        <p className='text-body-sm text-muted-foreground'>Hidden until opened.</p>
      </Disclosure>
      <Disclosure title='Long content' defaultOpen>
        <p className='text-body-sm text-muted-foreground'>
          The server is called with a bearer token issued at sign-in. When it expires the Box refreshes it once; if that fails the
          server shows as needing attention and every tool call returns the provider’s message until someone signs in again.
        </p>
      </Disclosure>
    </div>
  ),
}

export const InContext: Story = {
  args: { title: 'Advanced', children: null },
  render: () => (
    <div className='grid max-w-2xl gap-4'>
      <FieldGrid columns={2}>
        <Field label='Name'><Input defaultValue='Linear' /></Field>
        <Field label='Address'><Input mono defaultValue='https://mcp.linear.app/sse' /></Field>
      </FieldGrid>
      <Disclosure title='Advanced'>
        <FieldGrid columns={3}>
          <Field label='Timeout' hint='Seconds per call.'><Input type='number' defaultValue={30} /></Field>
          <Field label='Retries'><Input type='number' defaultValue={2} /></Field>
          <Field label='Header name'><Input mono defaultValue='Authorization' /></Field>
        </FieldGrid>
      </Disclosure>
    </div>
  ),
}
