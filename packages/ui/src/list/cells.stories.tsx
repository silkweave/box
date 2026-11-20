import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bug, Flag, Lightbulb, Rocket, Shield, Sparkles, Wrench } from 'lucide-react'
import { Money } from '../components/Figures.tsx'
import { DateCell, NumberCell, SelectCell, TagsCell, TextCell, TitleCell } from './cells.tsx'
import { OPTION_SEARCH_THRESHOLD } from '../components/OptionList.tsx'

/**
 * The production grid cells (`cells.tsx`), each rendered as the app renders it. Every fixture sits
 * in an element with `data-fixture`, which the rendered tests (`cells.rendered.ts`, run by `bun run
 * test:rendered`) find and measure: a cell's branches and data boundaries are fixtures here, not
 * reconstructions of its trigger.
 *
 * `SelectCell` changes its trigger past `OPTION_SEARCH_THRESHOLD` options (a searchable popover in
 * place of a Select), so the Select threshold story shows both sides, icon-only and text, in a wide
 * and a narrow host.
 */
const meta = {
  title: 'Grid/Cells',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const ICONS = { feature: Rocket, bug: Bug, idea: Lightbulb, chore: Wrench, security: Shield, launch: Flag, polish: Sparkles } as const
type Kind = keyof typeof ICONS
const KINDS = Object.keys(ICONS) as Kind[]
const label = (k: Kind) => k[0].toUpperCase() + k.slice(1)
const Glyph = ({ kind }: { kind: Kind }) => {
  const Icon = ICONS[kind]
  return <Icon aria-hidden data-glyph className='size-3.5 text-muted-foreground' />
}

/** A labelled host of a given width, the way a grid column holds a cell. */
function Host({ id, width, note, children }: { id: string; width: number; note?: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-label text-fg-4'>{note ?? id}</span>
      <div data-fixture={id} style={{ width }} className='flex min-h-8 items-center rounded outline outline-1 outline-dashed outline-border-light'>
        {children}
      </div>
    </div>
  )
}

function SelectFixture({ count, iconOnly, clearable }: { count: number; iconOnly: boolean; clearable?: boolean }) {
  const options = KINDS.slice(0, count)
  const [value, setValue] = useState<Kind | null>(options[0])
  return (
    <SelectCell<Kind>
      value={value}
      options={options}
      labelOf={label}
      label='Kind'
      iconOnly={iconOnly}
      emptyLabel={clearable ? 'No kind' : undefined}
      render={iconOnly ? (v) => <Glyph kind={v ?? 'feature'} /> : undefined}
      onChange={(v) => setValue(v || null)}
    />
  )
}

/** Both sides of the threshold, icon-only and text, wide and narrow. */
export const SelectThreshold: Story = {
  render: () => (
    <div data-shot className='grid grid-cols-4 gap-6 text-body-sm'>
      {[OPTION_SEARCH_THRESHOLD, OPTION_SEARCH_THRESHOLD + 1].flatMap((count) =>
        [true, false].flatMap((iconOnly) =>
          (['wide', 'narrow'] as const).map((w) => {
            const id = `select-${count}-${iconOnly ? 'icon' : 'text'}-${w}`
            const width = iconOnly ? (w === 'wide' ? 64 : 32) : w === 'wide' ? 200 : 96
            return (
              <Host key={id} id={id} width={width}>
                <SelectFixture count={count} iconOnly={iconOnly} clearable={!iconOnly} />
              </Host>
            )
          }),
        ),
      )}
    </div>
  ),
}

/** Money and a percentage: the unit at rest, the bare number while editing; read-only for a reader. */
export const Numbers: Story = {
  render: function Render() {
    const [mrr, setMrr] = useState<number | null>(1250)
    const [odds, setOdds] = useState<number | null>(40)
    const [empty, setEmpty] = useState<number | null>(null)
    return (
      <div data-shot className='flex gap-6 text-body-sm'>
        <Host id='number-money' width={120}>
          <NumberCell value={mrr} label='MRR' format={(n) => <Money value={n} />} onCommit={setMrr} />
        </Host>
        <Host id='number-percent' width={80}>
          <NumberCell value={odds} label='Probability' format={(n) => `${n}%`} max={100} onCommit={setOdds} />
        </Host>
        <Host id='number-empty' width={80}>
          <NumberCell value={empty} label='Seats' clearable onCommit={setEmpty} />
        </Host>
        <Host id='number-reader' width={120}>
          <NumberCell value={1250} label='MRR' format={(n) => <Money value={n} />} disabled onCommit={() => undefined} />
        </Host>
      </div>
    )
  },
}

/** Free text and an external id; a reader sees text only. */
export const Text: Story = {
  render: function Render() {
    const [next, setNext] = useState<string | null>('Send the renewal quote')
    return (
      <div data-shot className='flex gap-6 text-body-sm'>
        <Host id='text' width={200}>
          <TextCell value={next} label='Next action' onCommit={setNext} />
        </Host>
        <Host id='text-mono' width={200}>
          <TextCell mono value='cus_Q2x8Lr0d' label='Stripe customer id' onCommit={() => undefined} />
        </Host>
        <Host id='text-empty' width={140}>
          <TextCell value={null} label='Loss reason' onCommit={() => undefined} />
        </Host>
        <Host id='text-reader' width={200}>
          <TextCell value='Send the renewal quote' label='Next action' disabled onCommit={() => undefined} />
        </Host>
      </div>
    )
  },
}

/** A day, a day with a tone, and a moment (`time`) read relative with a time field in the popover. */
export const Dates: Story = {
  render: function Render() {
    const [day, setDay] = useState('2026-11-24')
    const [at, setAt] = useState('2026-11-24T08:30:00.000Z')
    return (
      <div data-shot className='flex gap-6 text-body-sm'>
        <Host id='date' width={120}>
          <DateCell value={day} label='Due date' onChange={setDay} />
        </Host>
        <Host id='date-overdue' width={120}>
          <DateCell value='2026-11-02' label='Due date' tone='danger' onChange={() => undefined} />
        </Host>
        <Host id='date-empty' width={120}>
          <DateCell value={null} label='Due date' onChange={() => undefined} />
        </Host>
        <Host id='date-time' width={160}>
          <DateCell time value={at} label='Due' onChange={setAt} />
        </Host>
      </div>
    )
  },
}

/** A title that opens its record, one with no record (the title renames), and the read-only summary line. */
export const Titles: Story = {
  render: function Render() {
    const [a, setA] = useState('Launch the help center')
    const [b, setB] = useState('Call the accountant')
    return (
      <div data-shot className='flex gap-6 text-body-sm'>
        <Host id='title-link' width={260}>
          <TitleCell value={a} label='Initiative title' href='#' onOpen={() => undefined} onCommit={setA} />
        </Host>
        <Host id='title-summary' width={260}>
          <TitleCell value='Wired graph' summary='Every signal that takes part in a dependency edge.' label='Board name' href='#' onOpen={() => undefined} onCommit={() => undefined} />
        </Host>
        <Host id='title-plain' width={260}>
          <TitleCell value={b} summary='Before the quarter closes' label='Reminder name' onCommit={setB} />
        </Host>
      </div>
    )
  },
}

/** Tags clipped at the edge with a `+n`, and none. */
export const Tags: Story = {
  render: function Render() {
    const [tags, setTags] = useState(['beta', 'growth', 'onboarding', 'pricing'])
    return (
      <div data-shot className='flex gap-6 text-body-sm'>
        <Host id='tags' width={180}>
          <TagsCell tags={tags} suggestions={['beta', 'growth', 'onboarding', 'pricing', 'retention']} onChange={setTags} />
        </Host>
        <Host id='tags-empty' width={120}>
          <TagsCell tags={[]} suggestions={[]} onChange={() => undefined} />
        </Host>
      </div>
    )
  },
}
