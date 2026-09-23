import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button.tsx'
import { InlineDialog, InlineDialogContent, InlineDialogDescription, InlineDialogScope, InlineDialogTitle } from './InlineDialog.tsx'

const meta = { title: 'Components/Inline editor', component: InlineDialogScope } satisfies Meta<typeof InlineDialogScope>
export default meta

export const Editor: StoryObj<typeof meta> = {
  args: { children: null },
  render: () => {
    const [open, setOpen] = useState(false)
    return <div className='h-96 max-w-xl border border-border bg-surface'>
      <InlineDialogScope>
        <div className='p-6'><Button onClick={() => setOpen(true)}>Edit item</Button></div>
        <InlineDialog open={open} onOpenChange={setOpen}>
          <InlineDialogContent>
            <InlineDialogTitle>Edit item</InlineDialogTitle>
            <InlineDialogDescription>The editor occupies this pane and Back restores the list.</InlineDialogDescription>
            <label>Name<input aria-label='Name' className='ml-2 rounded border border-border p-2' defaultValue='Example' /></label>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </InlineDialogContent>
        </InlineDialog>
      </InlineDialogScope>
    </div>
  },
}
