import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Button } from './Button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './Dialog.tsx'

const meta = {
  title: 'Base/Dialog',
  decorators: [withStage],
  component: DialogContent,
} satisfies Meta<typeof DialogContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant='outline'>Edit signal</Button>} />
      <DialogContent className='w-[28rem]'>
        <DialogTitle>Edit signal</DialogTitle>
        <DialogDescription>Rename the signal or move it to another channel.</DialogDescription>
        <div className='mt-4 flex justify-end gap-2'>
          <DialogClose render={<Button variant='ghost'>Cancel</Button>} />
          <DialogClose render={<Button>Save</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  ),
}

/** `showClose={false}` for a dialog whose only exits are its own buttons. */
export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant='outline'>Open</Button>} />
      <DialogContent showClose={false} className='w-[24rem]'>
        <DialogTitle>Finish setup</DialogTitle>
        <DialogDescription>Pick a channel before continuing.</DialogDescription>
        <div className='mt-4 flex justify-end'>
          <DialogClose render={<Button>Done</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  ),
}
