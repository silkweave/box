import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { SearchInput } from './SearchInput.tsx'

const meta = {
  title: 'Base/SearchInput',
  decorators: [withStage],
  component: SearchInput,
} satisfies Meta<typeof SearchInput>

export default meta
type Story = StoryObj<typeof meta>

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return <SearchInput value={value} onChange={setValue} placeholder='Search recipes' className='w-80' />
}

export const Empty: Story = {
  args: { value: '', onChange: () => {} },
  render: () => <Controlled initial='' />,
}

/** The clear button appears once there is text; Escape clears too. */
export const WithValue: Story = {
  args: { value: 'plan', onChange: () => {} },
  render: () => <Controlled initial='plan' />,
}
