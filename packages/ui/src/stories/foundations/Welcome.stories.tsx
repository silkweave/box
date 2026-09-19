import type { Meta, StoryObj } from '@storybook/react-vite'
import { Wordmark } from '../../brand/Wordmark.tsx'
import { Page, Section } from './scaffold.tsx'

const SECTIONS = [
  ['Foundations', 'The token system itself - colour, type, spacing, radii, elevation, motion. Everything below is built out of these.'],
  ['Brand', 'The mark and the wordmark, and the rules for using them.'],
  ['Layout', 'The app shell and page scaffolding: sidebar, top bar, page header, containers, split panes.'],
  ['Base', 'The unopinionated primitives - button, badge, select, dialog, popover, inputs. No domain knowledge.'],
  ['Modules', 'Namespaces that carry a seam of their own: Users, Editor, Ops. Each is a slice of the library an app fills through a provider.'],
] as const

const meta: Meta = { title: 'Foundations/Welcome' }
export default meta
type Story = StoryObj

export const Welcome: Story = {
  render: () => (
    <Page
      title="Silkweave Box UI"
      lede="The Box component library: design tokens, primitives and the app shell - free of tRPC, auth, the feature registry and the agent stack. Apps inject their data through the seams this package exports."
    >
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <Wordmark />
      </div>

      <Section title="How this is organised">
        <dl className="flex flex-col gap-3">
          {SECTIONS.map(([name, what]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <dt className="text-body font-semibold text-text">{name}</dt>
              <dd className="text-body-sm text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="The house rule">
        <p className="text-body-sm text-muted-foreground">
          Storybook is the library's only consumer that is not an app, and that is the point: if a
          component cannot be rendered here - with no tRPC client, no session and no feature registry
          in scope - then it is not a Box UI component and belongs in apps/web. A component without a
          story is not in the library.
        </p>
      </Section>

      <Section title="Theme">
        <p className="text-body-sm text-muted-foreground">
          Light and dark are one token swap on <code className="font-mono text-code">&lt;html data-theme&gt;</code>.
          The Theme control in the toolbar writes that attribute - the same mechanism the real app uses,
          which is what makes "it looked right in Storybook" mean something. The Storybook chrome
          follows it too.
        </p>
      </Section>
    </Page>
  ),
}
