import { Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { LayoutGrid, Waypoints } from 'lucide-react'
import { CenteredNote, type NavItem, type Crumb } from '@silkweave/box-ui'
import { RouteChrome } from '../../lib/routeShell.tsx'
import { useHref, useRouteLink } from '../../lib/href.ts'
import { useBoardsData } from '../lib/useBoardsData.ts'

/** The Circuit Boards shell: one sidebar entry per board (label + node count) above the index.
 *  The canvas (the index or one board) renders through the Outlet from the child routes. */
export function BoardsLayout() {
  const navigate = useNavigate()
  const href = useHref()
  const link = useRouteLink()
  // strict:false so one layout serves both /boards and /boards/$id.
  const { id } = useParams({ strict: false }) as { id?: string }
  const { data, error } = useBoardsData()

  if (error)
    return (
      <CenteredNote>
        Failed to reach the API: {error}
        <br />
        Start the backend: <code>box dev</code>.
      </CenteredNote>
    )
  if (!data) return <CenteredNote>Loading…</CenteredNote>

  const navItems: NavItem[] = [
    { id: 'all', label: 'All boards', icon: LayoutGrid, count: data.boards.length, href: href({ to: '/boards' }) },
    ...data.boards.map((b) => ({
      id: b.id,
      label: b.label,
      icon: Waypoints,
      // Node count = MEMBERSHIP, which is the only thing a board row stores about size.
      count: b.nodes.length,
      href: href({ to: '/boards/$id', params: { id: b.id } }),
    })),
  ]

  const onSelect = (next: string) =>
    void navigate(next === 'all' ? { to: '/boards' } : { to: '/boards/$id', params: { id: next } })

  const active = id ? data.boards.find((b) => b.id === id) : undefined
  const crumbs: Crumb[] = [{ label: 'Circuit Boards', ...(id ? link({ to: '/boards' }) : {}) }]
  crumbs.push({
    label: id ? (active?.label ?? id) : 'All boards',
    // The board's description lives behind an info icon on its crumb; the canvas gets the height.
    ...(active && {
      info: (
        <p>
          {active.description ||
            `${active.nodes.length} nodes on this board. An edge points from what moves to what it moves: a driver to the signal it drives, a signal to the goal it measures, an initiative to its goals.`}
        </p>
      ),
    }),
  })

  return (
    <RouteChrome items={navItems} activeId={id ?? 'all'} onSelect={onSelect} topbar={{ crumbs }}>
      <Outlet />
    </RouteChrome>
  )
}
