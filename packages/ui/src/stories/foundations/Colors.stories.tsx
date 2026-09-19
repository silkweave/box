import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Row, Section } from './scaffold.tsx'

const BACKGROUNDS = ['--bg', '--bg-surface', '--bg-surface-hover', '--bg-code', '--sidebar']
const BORDERS = ['--border', '--border-light', '--border-strong', '--shine']
const TEXT = ['--fg-1', '--fg-2', '--fg-3', '--fg-4', '--fg-disabled']
const ACCENT = ['--accent', '--accent-hover', '--accent-dim', '--accent-bg']
const SEMANTIC = ['--success', '--success-bg', '--warning', '--warning-bg', '--danger', '--danger-bg', '--info', '--info-bg']
const SILK = ['--silk-magenta', '--silk-purple', '--silk-violet', '--silk-indigo', '--silk-cyan']

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-8 w-16 rounded-sm border border-border"
        style={{ background: `var(${token})` }}
      />
      <span className="font-mono text-body-sm text-muted-foreground">var({token})</span>
    </div>
  )
}

function Swatches({ tokens }: { tokens: string[] }) {
  return (
    <div>
      {tokens.map((t) => (
        <Row key={t} name={t}>
          <Swatch token={t} />
        </Row>
      ))}
    </div>
  )
}

const meta: Meta = {
  title: 'Foundations/Colors',
  parameters: { a11y: { test: 'off' } },
}
export default meta
type Story = StoryObj

export const Palette: Story = {
  render: () => (
    <Page
      title="Colors"
      lede="src/styles/tokens.css is the single source of colour truth. Light is the default; dark is the same token names re-declared under [data-theme='dark'], so flip the toolbar Theme control and every swatch below re-paints with no JS. Components consume these through the Tailwind utilities in globals.css @theme (bg-surface, text-fg-2, border-border) - never raw hex."
    >
      <Section title="Backgrounds" note="Canvas, panels, hover, code, and the shell's sidebar.">
        <Swatches tokens={BACKGROUNDS} />
      </Section>
      <Section title="Borders" note="--shine is the inset frame's edge: a touch stronger than --border.">
        <Swatches tokens={BORDERS} />
      </Section>
      <Section title="Foreground" note="Four steps of emphasis plus a disabled stop.">
        <Swatches tokens={TEXT} />
      </Section>
      <Section title="Accent" note="One indigo accent. --accent-bg is the tinted surface for active rows and soft fills.">
        <Swatches tokens={ACCENT} />
      </Section>
      <Section title="Semantic" note="Each status pairs a foreground with a tinted background.">
        <Swatches tokens={SEMANTIC} />
      </Section>
      <Section
        title="Silk gradient"
        note="Theme-independent, and reserved for the mark and brand flourishes - not for UI state."
      >
        <Swatches tokens={SILK} />
        <div className="mt-3 h-12 rounded-md" style={{ background: 'var(--silk-gradient)' }} />
      </Section>
    </Page>
  ),
}
