import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useRef, useState } from 'react'
import { DocEditor } from './DocEditor.tsx'
import type { DocHandle, DocStatus } from './types.ts'

const meta = {
  title: 'Editor/DocEditor',
  component: DocEditor,
} satisfies Meta<typeof DocEditor>

export default meta
type Story = StoryObj<typeof meta>

const SAMPLE = `# Ship the UI package

The component library moves out of the SPA so a fresh Box imports it rather than copying it.

- [x] Move the primitives
- [ ] Write a story for each
- [ ] Fold the four editors into one

| Step | State |
| --- | --- |
| Primitives | done |
| Seams | in progress |
`

/**
 * A stand-in for whatever an app's document store is. It is deliberately a plain `useState` plus a
 * timer, because that is the entire contract: the editor is controlled, and debouncing and
 * persistence are the app's business. apps/web hands in `useDoc`, which is tRPC-backed.
 */
function useMockDoc(initial: string): DocHandle {
  const [content, setContent] = useState<string | null>(initial)
  const [status, setStatus] = useState<DocStatus>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const update = useCallback((next: string) => {
    setContent(next)
    setStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setStatus('saving')
      setTimeout(() => setStatus((s) => (s === 'saving' ? 'saved' : s)), 400)
    }, 600)
  }, [])
  return { content, status, path: 'docs/planning/ship-the-ui-package.md', editorUri: '', update }
}

export const Card: Story = {
  args: {} as never,
  render: () => {
    const doc = useMockDoc(SAMPLE)
    return (
      <div className='h-[36rem] p-6'>
        <DocEditor doc={doc} docKey='initiative/ship-the-ui-package' variant='card' />
      </div>
    )
  },
}

export const Panel: Story = {
  args: {} as never,
  render: () => {
    const doc = useMockDoc(SAMPLE)
    return (
      <div className='h-[36rem]'>
        <DocEditor doc={doc} docKey='initiative/ship-the-ui-package' variant='panel' />
      </div>
    )
  },
}

/** A shorter writing area, for a surface that is not the whole page (a task modal). */
export const Compact: Story = {
  args: {} as never,
  render: () => {
    const doc = useMockDoc('A short note.')
    return (
      <div className='p-6'>
        <DocEditor doc={doc} docKey='task/note' compact placeholder='Nothing here yet.' />
      </div>
    )
  },
}

/** `content: null` is loading. The Suspense fallback for the TipTap chunk sits behind this too. */
export const Loading: Story = {
  args: {} as never,
  render: () => (
    <div className='h-[24rem] p-6'>
      <DocEditor
        doc={{ content: null, status: 'loading', path: '', editorUri: '', update: () => {} }}
        docKey='initiative/loading'
      />
    </div>
  ),
}

export const Error: Story = {
  args: {} as never,
  render: () => (
    <div className='h-[24rem] p-6'>
      <DocEditor
        doc={{ content: null, status: 'error', path: 'docs/planning/gone.md', editorUri: '', update: () => {} }}
        docKey='initiative/gone'
      />
    </div>
  ),
}
