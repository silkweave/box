import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { GanttChart, Kanban, Rows3 } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import { BoardViewBar, type BoardBarSpec, type BoardBarValue } from './BoardViewBar.tsx'
import { DUE_FIELD, ESTIMATE_FIELD, FLAG_FIELD, OWNER_FIELD, STATUS_FIELD, STORY_TODAY } from '../filters/fixtures.ts'

const meta = {
  title: 'Board/BoardViewBar',
  component: BoardViewBar,
} satisfies Meta<typeof BoardViewBar>

export default meta
type Story = StoryObj<typeof meta>

const SPEC: BoardBarSpec = {
  noun: 'accounts',
  searchPlaceholder: 'Search accounts...',
  layouts: [
    { value: 'list', label: 'List', icon: Rows3 },
    { value: 'board', label: 'Pipeline', icon: Kanban },
  ],
  groupBy: [
    { value: 'none', label: 'Nothing' },
    { value: 'owner', label: 'Owner' },
    { value: 'status', label: 'Status' },
  ],
  sort: [
    { value: 'name', label: 'Name' },
    { value: 'value', label: 'Value', defaultDir: 'desc' },
    { value: 'contact', label: 'Last contact', defaultDir: 'desc' },
  ],
  columns: [
    { key: 'value', label: 'Value' },
    { key: 'probability', label: 'Probability' },
    { key: 'contact', label: 'Last contact' },
    { key: 'tags', label: 'Tags' },
  ],
  columnsNote: 'Name, owner and status are always shown.',
  // One field of each common type: the funnel opens the typed panel, and `pins` lets a preset put
  // a field in the row as a chip.
  fields: [STATUS_FIELD, OWNER_FIELD, DUE_FIELD, ESTIMATE_FIELD, FLAG_FIELD],
}

const START: BoardBarValue = {
  search: '',
  layout: 'list',
  groupBy: 'none',
  sort: 'name',
  sortDir: 'asc',
  filters: {},
  pinned: [],
  columns: ['value', 'probability'],
}

function Frame({ spec = SPEC, presets, pins, start = START }: { spec?: BoardBarSpec; presets?: ReactNode; pins?: boolean; start?: BoardBarValue }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <BoardViewBar
        value={value}
        onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
        spec={spec}
        presets={presets}
        pins={pins}
        today={STORY_TODAY}
      />
      {/* The state the bar is editing, so a story shows what each control actually writes. */}
      <pre className='overflow-x-auto p-3 font-mono text-label text-muted-foreground'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </>
  )
}

/**
 * The bar is CONTROLLED and owns no storage: `value` in, a PATCH out. Never a whole state object -
 * switching the sort field writes two fields at once, and an app's own view state is narrower than
 * this one (its filter axes are enums) and usually carries more. Where that state lives - a store,
 * the URL, a server record - is the app's business.
 *
 * Nothing is on screen unless it is doing work: the filters hide in a popover (one typed editor per
 * field: options, a person, a date window or range, a number) and surface as a count on the funnel, the × appears only once there is something to clear, and Group-by and Columns are
 * list concepts that disappear on the board (which already groups, in columns).
 */
export const Default: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => <Frame />,
}

/**
 * `presets` is a SLOT, not a component: a preset is persisted somewhere only the app knows about
 * (this Box keeps the team's list on the server and which one you are on in the URL), so the control
 * that manages them cannot live in a library that is not allowed to know what a server is.
 */
export const WithPresetSlot: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => (
    <Frame
      presets={
        <Button variant='outline' size='sm'>
          Critical path
        </Button>
      }
    />
  ),
}

/**
 * A board whose rows have no order to choose hands over an empty `sort` list, and NEITHER half of
 * the sort control renders - not a disabled select, not a lone direction arrow. Same for `columns`
 * and `groupBy`.
 */
export const NoSortAxes: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => <Frame spec={{ ...SPEC, sort: [], groupBy: [], columns: [] }} />,
}

/**
 * `notice` is for a scope imposed from OUTSIDE the bar that is narrowing the board anyway - a "only
 * my items" toggle in a user menu, say. A filter you cannot see is a filter you forget you set.
 */
export const WithNotice: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => <Frame spec={{ ...SPEC, notice: "Only Ada's" }} />,
}

/**
 * A module adds a layout only it draws - here a timeline - as one more `layouts` entry. It declares
 * what applies to it: a timeline's rows are a list, so `groups` keeps the group-by select; its rows
 * carry no columns, so the column picker stays away. `list` and `board` need no flags.
 */
export const ModuleLayout: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => (
    <Frame spec={{ ...SPEC, layouts: [...SPEC.layouts, { value: 'timeline', label: 'Timeline', icon: GanttChart, groups: true }] }} />
  ),
}

/**
 * With `pins` (a board with presets), the filter panel offers a star per field, and each pinned
 * field sits in the row right after search as a chip with its value. A chip opens that one field's
 * editor; set, it is tinted and has its own x. Pins are view state (`value.pinned`), so a preset
 * stores them, and Clear empties the filters but leaves the chips where they are.
 */
export const PinnedFilters: Story = {
  args: { value: START, onChange: () => {}, spec: SPEC },
  render: () => (
    <Frame
      pins
      start={{ ...START, pinned: ['owner', 'due'], filters: { owner: ['me'], estimate: { op: 'gt', value: 4 } } }}
      presets={
        <Button variant='outline' size='sm'>
          My week
        </Button>
      }
    />
  ),
}
