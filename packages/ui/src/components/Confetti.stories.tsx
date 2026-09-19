import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button.tsx'
import { Confetti } from './Confetti.tsx'

const meta = {
  title: 'Base/Confetti',
  component: Confetti,
} satisfies Meta<typeof Confetti>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A one-shot burst, fired by CHANGING `fire` - it is a counter, not a boolean, so the same
 * celebration can happen twice in a row. It paints a fixed, pointer-transparent canvas over
 * everything, which is why it claims the whole story rather than sitting on the stage.
 *
 * Under `prefers-reduced-motion: reduce` it renders nothing at all - not a slower version. A burst
 * of moving specks is exactly the effect that setting exists to turn off, so the button below does
 * nothing visible when your OS asks for reduced motion. That is correct.
 */
export const Default: Story = {
  args: { fire: 0 },
  render: () => {
    const [fire, setFire] = useState(0)
    return (
      <div className='grid min-h-screen place-items-center'>
        <Button onClick={() => setFire((n) => n + 1)}>Ship it</Button>
        <Confetti fire={fire} />
      </div>
    )
  },
}
