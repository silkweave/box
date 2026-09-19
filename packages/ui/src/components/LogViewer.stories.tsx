import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { LogViewer, type LogLine } from './LogViewer.tsx'

const meta = {
  title: 'Base/LogViewer',
  decorators: [withStage],
  component: LogViewer,
} satisfies Meta<typeof LogViewer>

export default meta
type Story = StoryObj<typeof meta>

const LINES: LogLine[] = [
  { text: 'github: starting' },
  { text: 'github: fetched 128 events' },
  { text: 'github: persisted 128 rows' },
  { text: '128 events, 3 new stars', tone: 'accent' },
]

export const Running: Story = {
  args: {
    title: 'Ingest github',
    status: { tone: 'busy', label: 'running' },
    lines: LINES.slice(0, 2),
    emptyNote: 'Run an action to stream its progress here.',
    countLabel: (n) => `${n} steps`,
  },
}

/** The last line is the summary, emphasised by the CALLER passing `tone: 'accent'`. */
export const Done: Story = {
  args: {
    title: 'Ingest github',
    status: { tone: 'success', label: 'success' },
    lines: LINES,
    emptyNote: 'Run an action to stream its progress here.',
    countLabel: (n) => `${n} steps`,
  },
}

export const Failed: Story = {
  args: {
    title: 'Ingest reddit',
    status: { tone: 'error', label: 'error' },
    lines: [
      { text: 'reddit: starting' },
      { text: 'reddit: 401 Unauthorized - token expired', tone: 'danger' },
    ],
    emptyNote: 'Run an action to stream its progress here.',
    countLabel: (n) => `${n} steps`,
  },
}

export const Empty: Story = {
  args: { title: null, status: null, lines: [], emptyNote: 'Run an action to stream its progress here.' },
}

/**
 * The rename's whole point: nothing here is about a "run". Same component, a deploy's vocabulary,
 * a caller-supplied status word that is not in the library's tone list.
 */
export const NotARun: Story = {
  args: {
    title: 'Deploy to production',
    status: { tone: 'neutral', label: 'skipped' },
    lines: [
      { text: '$ pnpm build', tone: 'muted' },
      { text: 'built in 7.02s' },
      { text: 'no changes to deploy - skipping', tone: 'muted' },
    ],
    emptyNote: 'Nothing to show yet.',
    countLabel: (n) => `${n} lines`,
  },
}
