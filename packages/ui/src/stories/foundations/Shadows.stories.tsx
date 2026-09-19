import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Row, Section } from './scaffold.tsx'

const SHADOWS = ['--shadow-xs', '--shadow-sm', '--shadow', '--shadow-md', '--shadow-lg', '--shadow-glow'] as const

const meta: Meta = { title: 'Foundations/Shadows' }
export default meta
type Story = StoryObj

export const Elevation: Story = {
  render: () => (
    <Page
      title="Shadows"
      lede="Elevation is theme-aware and not merely dimmed: in light the shadows imitate a soft overhead light, in dark they exist to separate surfaces rather than to fake one, so they spread wider and darker. Flip the toolbar Theme control to see the swap - the token names do not change."
    >
      <Section title="Elevation">
        <div>
          {SHADOWS.map((token) => (
            <Row key={token} name={token}>
              <div
                className="h-12 w-40 rounded-md border border-border bg-surface"
                style={{ boxShadow: `var(${token})` }}
              />
            </Row>
          ))}
        </div>
      </Section>
      <Section
        title="Frame"
        note="--frame-shadow is the app shell's inset content panel. It is not an alias: light uses the xs drop, dark uses its own wider, darker one."
      >
        <div
          className="h-16 w-full rounded-lg border bg-surface"
          style={{ borderColor: 'var(--shine)', boxShadow: 'var(--frame-shadow)' }}
        />
      </Section>
    </Page>
  ),
}
