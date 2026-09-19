import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

const meta = {
  title: 'Layout/ThemeToggle',
  decorators: [withStage],
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Writes `<html data-theme>` and persists the pref - the real thing, not a simulation. It will
 * therefore fight the toolbar's own theme switch; that is the mechanism working, not a bug.
 */
export const Default: Story = {}
