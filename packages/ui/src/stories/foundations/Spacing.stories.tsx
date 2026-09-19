import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Row, Section } from './scaffold.tsx'

// Tailwind's default 4px base. Listed as the steps this library actually reaches for, so the
// page documents house practice rather than re-printing Tailwind's full ramp.
const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16] as const

const meta: Meta = { title: 'Foundations/Spacing' }
export default meta
type Story = StoryObj

export const Scale: Story = {
  render: () => (
    <Page
      title="Spacing"
      lede="Tailwind's 4px base, unmodified. The number in a utility is the multiplier: p-4 is 16px. The library sticks to the steps below, which keeps gutters and rhythm consistent without a second vocabulary to remember."
    >
      <Section title="Scale" note="Width of the bar = the value the step resolves to.">
        <div>
          {STEPS.map((step) => (
            <Row key={step} name={`p-${step} / gap-${step} / m-${step}`}>
              <div className="flex items-center gap-3">
                <div
                  className="h-4 rounded-sm bg-accent"
                  style={{ width: `calc(var(--spacing, 0.25rem) * ${step})` }}
                />
                <span className="font-mono text-body-sm text-muted-foreground">{step * 4}px</span>
              </div>
            </Row>
          ))}
        </div>
      </Section>
      <Section
        title="Reading column"
        note="max-w-reading (48rem / 768px) caps prose and any long-form panel, so line length stays readable on a wide screen."
      >
        <div className="max-w-reading rounded-md border border-border bg-surface p-4 text-body-sm text-muted-foreground">
          This block is max-w-reading. Everything long-form in the Box - docs, chat transcripts,
          editor content - lives inside this cap.
        </div>
      </Section>
    </Page>
  ),
}
