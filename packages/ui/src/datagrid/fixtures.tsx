// Stand-in rows for the DataGrid stories: a page of initiatives and one initiative's milestones and
// tasks, nested. Planning-shaped because that is where the grid is hardest, but the component never
// sees these types - the stories hand it accessors, exactly as a feature would.
import { GanttChart, LayoutGrid, Rows3 } from 'lucide-react'
import { Badge } from '../components/Badge.tsx'
import { Money } from '../components/Figures.tsx'
import { UserChip } from '../users/UserChip.tsx'
import type { BoardBarValue, LayoutOption } from '../board/BoardViewBar.tsx'
import type { DataGridColumn, DataGridProps } from './DataGrid.tsx'
import { FORWARD_WINDOWS, type FilterOption } from '../filters/types.ts'

type Status = 'planned' | 'active' | 'blocked' | 'done'
const STATUS_VARIANT = { planned: 'neutral', active: 'accent', blocked: 'danger', done: 'success' } as const
const STATUS_LABEL: Record<Status, string> = { planned: 'Planned', active: 'Active', blocked: 'Blocked', done: 'Done' }
const StatusBadge = ({ s }: { s: Status }) => <Badge variant={STATUS_VARIANT[s]}>{STATUS_LABEL[s]}</Badge>

const Progress = ({ value }: { value: number | null }) => (
  <span className='flex items-center gap-2'>
    <span className='h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2'>
      <span className='block h-full rounded-full bg-accent' style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
    <span className='w-8 text-right text-label tabular-nums text-muted-foreground'>{value == null ? '·' : `${Math.round(value * 100)}%`}</span>
  </span>
)

const Due = ({ date }: { date: string | null }) => <span className={date ? 'tabular-nums text-text' : 'text-fg-4'}>{date ?? '-'}</span>

/** The fixtures' people, for the owner filters. */
const PEOPLE: FilterOption[] = ['ada', 'grace', 'alan', 'katherine'].map((u) => ({ value: u, label: u[0].toUpperCase() + u.slice(1) }))

export const LAYOUTS: LayoutOption[] = [
  { value: 'list', label: 'List', icon: Rows3 },
  { value: 'cards', label: 'Cards', icon: LayoutGrid, groups: true, columns: true },
]
export const LAYOUTS_WITH_TIMELINE: LayoutOption[] = [...LAYOUTS, { value: 'timeline', label: 'Timeline', icon: GanttChart }]

// ---- initiatives (a full page) -----------------------------------------------------------------

export interface Initiative {
  id: string
  title: string
  kind: 'program' | 'sales' | 'product'
  status: Status
  owner: string | null
  impact: 1 | 2 | 3 | 4
  progress: number | null
  due: string | null
  budget: number | null
}

export const INITIATIVES: Initiative[] = [
  { id: 'literaton', title: 'Literaton 2026/27', kind: 'program', status: 'active', owner: 'ada', impact: 4, progress: 0.42, due: '2027-04-24', budget: 48000 },
  { id: 'permata', title: 'Permata Bankcil 2026', kind: 'program', status: 'active', owner: 'grace', impact: 3, progress: 0.18, due: '2026-12-23', budget: 22000 },
  { id: 'retention', title: 'Priority schools retention and expansion', kind: 'sales', status: 'active', owner: 'katherine', impact: 4, progress: 0.3, due: '2026-12-24', budget: null },
  { id: 'sponsors', title: 'Grow and diversify sponsor revenue', kind: 'sales', status: 'blocked', owner: 'alan', impact: 3, progress: 0.05, due: '2026-12-24', budget: 12000 },
  { id: 'distribution', title: 'Build distribution partnership opportunities', kind: 'sales', status: 'planned', owner: 'ada', impact: 2, progress: null, due: '2026-12-24', budget: null },
  { id: 'math-3', title: 'Release Math Grade 3 full pack', kind: 'product', status: 'planned', owner: 'grace', impact: 2, progress: 0, due: '2027-02-01', budget: 9000 },
  { id: 'siap-membaca', title: 'Release Siap Membaca full pack', kind: 'product', status: 'planned', owner: null, impact: 1, progress: null, due: null, budget: null },
  { id: 'build-1', title: '2026 Q4 build cycle 1', kind: 'product', status: 'done', owner: 'alan', impact: 3, progress: 1, due: '2026-11-18', budget: 15000 },
]

const IMPACT = ['', 'Low', 'Medium', 'High', 'Very high']
const KIND_LABEL = { program: 'Program', sales: 'Sales', product: 'Product' }

export const INITIATIVE_COLUMNS: DataGridColumn<Initiative>[] = [
  { key: 'status', label: 'Status', width: 110, fixed: true, render: (r) => <StatusBadge s={r.status} /> },
  { key: 'owner', label: 'Owner', width: 110, fixed: true, render: (r) => <UserChip userId={r.owner} showName /> },
  { key: 'progress', label: 'Progress', width: 150, hint: 'Done hours over all hours', render: (r) => <Progress value={r.progress} />, agg: { value: (r) => (r.progress == null ? null : r.progress * 100), unit: 'percent' } },
  { key: 'impact', label: 'Impact', width: 96, render: (r) => <span className='text-muted-foreground'>{IMPACT[r.impact]}</span>, agg: { value: (r) => r.impact } },
  { key: 'kind', label: 'Kind', width: 96, render: (r) => <span className='text-muted-foreground'>{KIND_LABEL[r.kind]}</span> },
  { key: 'due', label: 'Due', width: 104, render: (r) => <Due date={r.due} /> },
  { key: 'budget', label: 'Budget', width: 120, render: (r) => <Money value={r.budget} />, agg: { value: (r) => r.budget, unit: 'currency' } },
]

export const INITIATIVE_VIEW: BoardBarValue = {
  search: '',
  layout: 'list',
  groupBy: 'none',
  sort: 'manual',
  sortDir: 'asc',
  filters: {},
  columns: ['progress', 'impact', 'due', 'budget'],
}

export const initiativeGrid: Omit<DataGridProps<Initiative>, 'view' | 'onViewChange' | 'rows'> = {
  getId: (r) => r.id,
  name: { label: 'Initiative', render: (r) => <span className='truncate font-medium'>{r.title}</span> },
  columns: INITIATIVE_COLUMNS,
  storageKey: 'storybook.datagrid.initiatives',
  bar: {
    noun: 'initiatives',
    searchPlaceholder: 'Search initiatives...',
    layouts: LAYOUTS,
    groupBy: [
      { value: 'none', label: 'Nothing' },
      { value: 'status', label: 'Status' },
      { value: 'kind', label: 'Kind' },
      { value: 'owner', label: 'Owner' },
    ],
    sort: [
      { value: 'manual', label: 'Manual', undirected: true },
      { value: 'title', label: 'Name' },
      { value: 'due', label: 'Due' },
      { value: 'impact', label: 'Impact', defaultDir: 'desc' },
      { value: 'progress', label: 'Progress', defaultDir: 'desc' },
    ],
    fields: [
      { key: 'status', title: 'Status', type: 'options', options: (['planned', 'active', 'blocked', 'done'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
      { key: 'kind', title: 'Kind', type: 'options', options: (['program', 'sales', 'product'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] })) },
      { key: 'owner', title: 'Owner', type: 'person', noneLabel: 'No owner', options: PEOPLE },
      { key: 'due', title: 'Due', type: 'date', windows: FORWARD_WINDOWS, noneLabel: 'No due date' },
    ],
  },
  searchText: (r) => r.title,
  filterValue: (r, axis) =>
    axis === 'status' ? r.status : axis === 'kind' ? r.kind : axis === 'owner' ? r.owner : axis === 'due' ? { day: r.due, open: r.status !== 'done' } : null,
  sortValue: (r, key) => (key === 'title' ? r.title : key === 'due' ? r.due : key === 'impact' ? r.impact : key === 'progress' ? r.progress : null),
  groupOf: (r, key) =>
    key === 'status'
      ? { key: r.status, label: <StatusBadge s={r.status} /> }
      : key === 'kind'
        ? { key: r.kind, label: KIND_LABEL[r.kind] }
        : { key: r.owner ?? '', label: r.owner ? <UserChip userId={r.owner} showName /> : 'No owner' },
}

// ---- one initiative's milestones and tasks (a card on its page) ----------------------------------

export interface Item {
  id: string
  parent: string | null
  kind: 'milestone' | 'task'
  title: string
  status: Status
  assignee: string | null
  hours: number | null
  due: string | null
  progress: number | null
}

export const ITEMS: Item[] = [
  { id: 'recruitment', parent: null, kind: 'milestone', title: 'Recruitment and selection', status: 'done', assignee: 'ada', hours: null, due: '2026-09-25', progress: 1 },
  { id: 'shortlist', parent: 'recruitment', kind: 'task', title: 'Shortlist 40 schools', status: 'done', assignee: 'ada', hours: 4, due: '2026-09-12', progress: null },
  { id: 'interviews', parent: 'recruitment', kind: 'task', title: 'Interview principals', status: 'done', assignee: 'grace', hours: 8, due: '2026-09-20', progress: null },
  { id: 'launch', parent: null, kind: 'milestone', title: 'Program launch', status: 'active', assignee: 'grace', hours: null, due: '2026-10-19', progress: 0.5 },
  { id: 'kickoff', parent: 'launch', kind: 'task', title: 'Kick-off event', status: 'done', assignee: 'grace', hours: 8, due: '2026-10-10', progress: null },
  { id: 'materials', parent: 'launch', kind: 'task', title: 'Print and ship materials', status: 'active', assignee: 'alan', hours: 4, due: '2026-10-17', progress: null },
  { id: 'materials-print', parent: 'materials', kind: 'task', title: 'Print run', status: 'done', assignee: 'alan', hours: 2, due: null, progress: null },
  { id: 'materials-ship', parent: 'materials', kind: 'task', title: 'Courier to 24 schools', status: 'blocked', assignee: 'alan', hours: 2, due: '2026-10-17', progress: null },
  { id: 'training', parent: null, kind: 'milestone', title: 'Teacher training (ToT)', status: 'planned', assignee: 'katherine', hours: null, due: '2027-02-05', progress: 0 },
  { id: 'trainers', parent: 'training', kind: 'task', title: 'Book four trainers', status: 'planned', assignee: 'katherine', hours: 2, due: '2026-12-01', progress: null },
  { id: 'venue', parent: 'training', kind: 'task', title: 'Venue for two sessions', status: 'planned', assignee: null, hours: 1, due: null, progress: null },
  { id: 'report-template', parent: null, kind: 'task', title: 'Impact report template', status: 'planned', assignee: 'ada', hours: 4, due: '2027-03-01', progress: null },
]

export const ITEM_VIEW: BoardBarValue = {
  search: '',
  layout: 'list',
  groupBy: 'none',
  sort: 'manual',
  sortDir: 'asc',
  filters: {},
  columns: ['assignee', 'hours', 'due'],
}

const Diamond = () => <span aria-hidden className='inline-block size-2.5 shrink-0 rotate-45 rounded-[2px] bg-accent' />
/** A task's mark: quiet, but it holds the same slot as a milestone's diamond so titles line up. */
const TaskMark = () => <span aria-hidden className='inline-block size-2.5 shrink-0 rounded-full border-[1.5px] border-fg-4' />

export const itemGrid: Omit<DataGridProps<Item>, 'view' | 'onViewChange' | 'rows'> = {
  getId: (r) => r.id,
  parentId: (r) => r.parent,
  name: {
    label: 'Milestones & tasks',
    render: (r) => <span className={r.kind === 'milestone' ? 'block truncate font-medium' : 'block truncate'}>{r.title}</span>,
  },
  icon: (r) => (r.kind === 'milestone' ? <Diamond /> : <TaskMark />),
  columns: [
    { key: 'status', label: 'Status', width: 140, fixed: true, render: (r) => (r.kind === 'milestone' ? <Progress value={r.progress} /> : <StatusBadge s={r.status} />) },
    { key: 'assignee', label: 'Owner', width: 110, render: (r) => <UserChip userId={r.assignee} showName /> },
    { key: 'hours', label: 'Estimate', width: 90, render: (r) => <span className='tabular-nums text-muted-foreground'>{r.hours == null ? '' : `${r.hours}h`}</span>, agg: { value: (r) => r.hours } },
    { key: 'due', label: 'Due', width: 104, render: (r) => <Due date={r.due} /> },
  ],
  storageKey: 'storybook.datagrid.items',
  bar: {
    noun: 'items',
    searchPlaceholder: 'Search...',
    layouts: LAYOUTS,
    groupBy: [
      { value: 'none', label: 'Nothing' },
      { value: 'status', label: 'Status' },
    ],
    sort: [
      { value: 'manual', label: 'Plan order', undirected: true },
      { value: 'due', label: 'Due' },
      { value: 'title', label: 'Name' },
    ],
    fields: [
      { key: 'status', title: 'Status', type: 'options', options: (['planned', 'active', 'blocked', 'done'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
      { key: 'assignee', title: 'Owner', type: 'person', noneLabel: 'No owner', options: PEOPLE },
      { key: 'due', title: 'Due', type: 'date', windows: FORWARD_WINDOWS, noneLabel: 'No due date' },
      { key: 'hours', title: 'Estimate', type: 'number', unit: 'h' },
    ],
  },
  searchText: (r) => r.title,
  filterValue: (r, axis) =>
    axis === 'status' ? r.status : axis === 'assignee' ? r.assignee : axis === 'due' ? { day: r.due, open: r.status !== 'done' } : axis === 'hours' ? r.hours : null,
  sortValue: (r, key) => (key === 'title' ? r.title : key === 'due' ? r.due : null),
  groupOf: (r) => ({ key: r.status, label: <StatusBadge s={r.status} /> }),
}

/** Apply a DataGrid move to the fixture rows: new parent, then the depth-first order. */
export function applyMove<T extends { id: string }>(rows: T[], move: { id: string; parentId: string | null; order: string[] }, setParent: (row: T, parent: string | null) => T): T[] {
  const byId = new Map(rows.map((r) => [r.id, r.id === move.id ? setParent(r, move.parentId) : r]))
  return move.order.flatMap((id) => byId.get(id) ?? [])
}

// ---- initiatives with their items (one page, items under each initiative) -----------------------

/** A row of the mixed list: an initiative (the top level, fixed) or one of its items. */
export type PlanRow = ({ type: 'initiative' } & Initiative) | ({ type: 'item'; initiative: string } & Item)

/** The initiatives, each followed by a few items; an item's `parent` is its parent item or null. */
export const PLAN_ROWS: PlanRow[] = [
  ...INITIATIVES.map((i): PlanRow => ({ type: 'initiative', ...i })),
  ...ITEMS.map((i): PlanRow => ({ type: 'item', initiative: 'literaton', ...i })),
  { type: 'item', initiative: 'permata', id: 'p-onboard', parent: null, kind: 'task', title: 'Onboard 12 schools', status: 'active', assignee: 'grace', hours: 6, due: '2026-11-20', progress: null },
  { type: 'item', initiative: 'permata', id: 'p-report', parent: null, kind: 'task', title: 'Quarterly sponsor report', status: 'planned', assignee: 'ada', hours: 3, due: '2026-12-15', progress: null },
  { type: 'item', initiative: 'sponsors', id: 's-pitch', parent: null, kind: 'task', title: 'Pitch deck refresh', status: 'blocked', assignee: 'alan', hours: 5, due: '2026-11-30', progress: null },
  { type: 'item', initiative: 'math-3', id: 'm-proof', parent: null, kind: 'task', title: 'Proofread chapters 1-4', status: 'planned', assignee: 'grace', hours: 8, due: '2027-01-10', progress: null },
]
