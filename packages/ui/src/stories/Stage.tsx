import * as React from 'react'
import type { Decorator } from '@storybook/react-vite'
import { cn } from '../lib/utils.ts'

/**
 * The story stage.
 *
 * Storybook itself adds NO padding here: the preview is `layout: 'fullscreen'` globally and the
 * theme decorator contributes only the canvas colour. That is deliberate - AppShell, Sidebar,
 * TopBar and the editor all want the full area, and a global gutter meant every one of them had to
 * opt out of it. Inverting that, a story that would otherwise hug the edge opts IN here, and the
 * gutter is one value in one file rather than a `p-6` copied into thirty stories.
 *
 * Use the decorator - `decorators: [withStage]` on the meta - unless a single story needs a
 * different inset, in which case wrap that story's render in `<Stage>` directly.
 */

interface StageProps {
  children: React.ReactNode
  /** `md` is the house gutter. `lg` suits a story that needs room to breathe (a wide table, a canvas). */
  inset?: 'sm' | 'md' | 'lg'
  /** Centre the content in the viewport - for a small, single component that reads better framed. */
  center?: boolean
  className?: string
}

const INSET = { sm: 'p-3', md: 'p-6', lg: 'p-10' } as const

export function Stage({ children, inset = 'md', center = false, className }: StageProps) {
  return (
    <div className={cn(INSET[inset], center && 'flex min-h-screen items-center justify-center', className)}>
      {children}
    </div>
  )
}

/** `decorators: [withStage]` - the house gutter, for any story that is not claiming the full area. */
export const withStage: Decorator = (Story) => (
  <Stage>
    <Story />
  </Stage>
)

/** `decorators: [withStageCentered]` - the same gutter, with the component centred in the viewport. */
export const withStageCentered: Decorator = (Story) => (
  <Stage center>
    <Story />
  </Stage>
)
