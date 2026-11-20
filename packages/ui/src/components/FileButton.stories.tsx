import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ImageUp } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { FileButton } from './FileButton.tsx'

const meta = {
  title: 'Base/FileButton',
  decorators: [withStage],
  component: FileButton,
} satisfies Meta<typeof FileButton>

export default meta
type Story = StoryObj

function Live() {
  const [picked, setPicked] = useState<string[]>([])
  return (
    <div className='flex items-center gap-3'>
      <FileButton accept='image/png,image/jpeg' icon={<ImageUp />} onFiles={(f) => setPicked(f.map((x) => x.name))}>Upload</FileButton>
      <span className='text-body-sm text-muted-foreground'>{picked.join(', ') || 'No file'}</span>
    </div>
  )
}

/** Opens the file picker; the caller gets the files. */
export const Default: Story = { render: () => <Live /> }

/** States: busy while the caller uploads, disabled, and a ghost import button. */
export const States: Story = {
  render: () => (
    <div className='flex items-center gap-3'>
      <FileButton busy onFiles={() => undefined}>Uploading</FileButton>
      <FileButton disabled onFiles={() => undefined}>Upload</FileButton>
      <FileButton variant='ghost' accept='.csv' onFiles={() => undefined}>Import CSV</FileButton>
    </div>
  ),
}
