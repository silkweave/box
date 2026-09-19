import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Row, Section } from './scaffold.tsx'

/**
 * Literal class strings, not `text-${step}`: Tailwind v4 finds utilities by scanning the source
 * for the class name as written, so an interpolated name is never emitted. This is the one place
 * in the library where that constraint is load-bearing, since the page's subject IS the scale.
 */
const DISPLAY = [
  ['text-display-xl', 'text-display-xl font-sans'],
  ['text-display-lg', 'text-display-lg font-sans'],
  ['text-display-md', 'text-display-md font-sans'],
  ['text-display-sm', 'text-display-sm font-sans'],
] as const

const HEADING = [
  ['text-heading-1', 'text-heading-1 font-sans font-semibold'],
  ['text-heading-2', 'text-heading-2 font-sans font-semibold'],
  ['text-heading-3', 'text-heading-3 font-sans font-semibold'],
] as const

const BODY = [
  ['text-body', 'text-body font-sans'],
  ['text-body-sm', 'text-body-sm font-sans'],
  ['text-label', 'text-label font-sans uppercase'],
  ['text-code', 'text-code font-mono'],
] as const

const WEIGHTS = [
  ['font-normal', 'text-body font-sans font-normal'],
  ['font-medium', 'text-body font-sans font-medium'],
  ['font-semibold', 'text-body font-sans font-semibold'],
  ['font-bold', 'text-body font-sans font-bold'],
] as const

const TRACKING = ['--tracking-tight', '--tracking-normal', '--tracking-wide', '--tracking-caps'] as const

const SPECIMEN = 'Silkweave Box - the quick brown fox'

function Scale({ steps }: { steps: readonly (readonly [string, string])[] }) {
  return (
    <div>
      {steps.map(([name, cls]) => (
        <Row key={name} name={name}>
          <p className={`${cls} text-text`}>{SPECIMEN}</p>
        </Row>
      ))}
    </div>
  )
}

const meta: Meta = { title: 'Foundations/Typography' }
export default meta
type Story = StoryObj

export const Scales: Story = {
  render: () => (
    <Page
      title="Typography"
      lede="Two faces, both self-hosted via @fontsource (no CDN at runtime): Inter for UI, body and display, JetBrains Mono for code and labels. There is no serif in the brand - the legacy font-serif role is aliased onto Inter. Each step below is one Tailwind utility carrying its own size, line-height and tracking."
    >
      <Section title="Display" note="Tight tracking (-0.02em) is baked into the step, per the Silkweave guide.">
        <Scale steps={DISPLAY} />
      </Section>
      <Section title="Headings">
        <Scale steps={HEADING} />
      </Section>
      <Section title="Body, label, code" note="text-label carries +0.02em and is usually paired with uppercase.">
        <Scale steps={BODY} />
      </Section>
      <Section title="Weights" note="Inter ships 400/500/600/700 - nothing lighter, nothing heavier.">
        <Scale steps={WEIGHTS} />
      </Section>
      <Section title="Tracking" note="The raw tokens, for the cases the type scale does not already cover.">
        <div>
          {TRACKING.map((t) => (
            <Row key={t} name={t}>
              <p className="text-body font-sans text-text" style={{ letterSpacing: `var(${t})` }}>
                SILKWEAVE BOX
              </p>
            </Row>
          ))}
        </div>
      </Section>
    </Page>
  ),
}
