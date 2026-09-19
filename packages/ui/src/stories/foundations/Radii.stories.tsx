import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Row, Section } from './scaffold.tsx'

const RADII = [
  ['rounded-sm', '--radius-sm', '6px', 'rounded-sm'],
  ['rounded-md', '--radius-md', '8px', 'rounded-md'],
  ['rounded-lg', '--radius-lg', '12px', 'rounded-lg'],
  ['rounded-full', '--radius-full', '9999px', 'rounded-full'],
] as const

const meta: Meta = { title: 'Foundations/Radii' }
export default meta
type Story = StoryObj

export const Scale: Story = {
  render: () => (
    <Page
      title="Radii"
      lede="Four stops, and --radius (the shadcn bridge token) points at --radius-md so a generated primitive lands on the house default without an edit. Anything rounder than lg is either a pill or an avatar - use rounded-full, not a bigger number."
    >
      <Section title="Scale">
        <div>
          {RADII.map(([util, token, px, cls]) => (
            <Row key={util} name={`${util}  (${token})`}>
              <div className="flex items-center gap-3">
                <div className={`h-10 w-20 border border-border bg-surface ${cls}`} />
                <span className="font-mono text-body-sm text-muted-foreground">{px}</span>
              </div>
            </Row>
          ))}
        </div>
      </Section>
    </Page>
  ),
}
