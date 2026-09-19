import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Page, Row, Section } from './scaffold.tsx'

const DURATIONS = [
  ['--motion-fast', '120ms', 'hover, focus, colour swaps'],
  ['--motion-base', '150ms', 'the default - most state changes'],
  ['--motion-slow', '220ms', 'entrances: dialogs, popovers, panels'],
] as const

const EASINGS = [
  ['--ease-standard', 'the house default'],
  ['--ease-emphasized', 'entrances that should feel decisive'],
  ['--ease-out', 'Silkweave-native, for a settle'],
  ['--ease-in-out', 'symmetric, for a loop'],
] as const

/** Click to replay: a transition is only legible while it is running. */
function Demo({ duration, easing }: { duration: string; easing: string }) {
  const [on, setOn] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className="flex w-full items-center gap-3 rounded-sm text-left"
      aria-label="Replay"
    >
      <span className="block h-6 w-40 rounded-sm bg-surface">
        <span
          className="block h-6 w-6 rounded-sm bg-accent motion-reduce:transition-none"
          style={{
            transform: on ? 'translateX(136px)' : 'translateX(0)',
            transitionProperty: 'transform',
            transitionDuration: `var(${duration})`,
            transitionTimingFunction: `var(${easing})`,
          }}
        />
      </span>
      <span className="text-body-sm text-muted-foreground">click to replay</span>
    </button>
  )
}

const meta: Meta = { title: 'Foundations/Motion' }
export default meta
type Story = StoryObj

export const Timing: Story = {
  render: () => (
    <Page
      title="Motion"
      lede="Three durations and four easings, and a hard rule above them: prefers-reduced-motion collapses every transition and animation to ~0ms in globals.css @layer base. Motion here is confirmation, never decoration, so nothing in the library depends on an animation completing to become usable."
    >
      <Section title="Durations" note="Easing held at --ease-standard so the duration is what you are comparing.">
        <div>
          {DURATIONS.map(([token, ms, use]) => (
            <Row key={token} name={`${token}  (${ms})`}>
              <div className="flex flex-col gap-1">
                <Demo duration={token} easing="--ease-standard" />
                <span className="text-body-sm text-muted-foreground">{use}</span>
              </div>
            </Row>
          ))}
        </div>
      </Section>
      <Section title="Easings" note="Duration held at --motion-slow so the curve is what you are comparing.">
        <div>
          {EASINGS.map(([token, use]) => (
            <Row key={token} name={token}>
              <div className="flex flex-col gap-1">
                <Demo duration="--motion-slow" easing={token} />
                <span className="text-body-sm text-muted-foreground">{use}</span>
              </div>
            </Row>
          ))}
        </div>
      </Section>
      <Section
        title="Focus ring"
        note="Not motion, but the same category of promise: :focus-visible is a 2px accent outline at 2px offset, set once in globals.css. Tab into the button above rather than clicking it."
      >
        <button
          type="button"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-body-sm text-text"
        >
          Tab to me
        </button>
      </Section>
    </Page>
  ),
}
