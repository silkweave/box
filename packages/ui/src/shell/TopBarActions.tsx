// A view's primary actions ("New initiative", "New account") belong in the TOP BAR, beside the
// breadcrumbs - not in a page heading the view draws for itself (2026-08-12). The heading is gone
// from the grids: the breadcrumb already says where you are, and a serif title plus a paragraph of
// prose above a data grid pushes the first row of actual data below the fold.
//
// The problem that leaves: the button belongs to the VIEW (it owns the create dialog, and the list
// of ids that dialog validates against), while the top bar belongs to the LAYOUT two levels up. The
// choices are to lift the dialog into the layout - which drags the view's state up with it, into a
// component that has no other reason to know about it - or to portal the button down. This is the
// portal. `AppShell` publishes a slot in the bar; a view renders `<TopBarActions>` anywhere in its
// tree and its children come out up there.

import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const SlotContext = createContext<HTMLElement | null>(null)
/** The CENTRE of the bar, for a view's own view-switcher (the sprint tabs). Separate slot rather
 *  than a flag on the first, because the two land in different boxes and a view uses them at once. */
const CenterSlotContext = createContext<HTMLElement | null>(null)

/** AppShell's side of the wire: hold the slot element in state (a ref would not re-render the
 *  consumers when it lands) and hand it to the tree below. */
export function useTopBarSlot(): { ref: (el: HTMLDivElement | null) => void; node: HTMLElement | null } {
  const [node, setNode] = useState<HTMLElement | null>(null)
  return { ref: setNode, node }
}

export function TopBarSlotProvider({
  node,
  centerNode,
  children,
}: {
  node: HTMLElement | null
  centerNode: HTMLElement | null
  children: ReactNode
}) {
  return (
    <SlotContext.Provider value={node}>
      <CenterSlotContext.Provider value={centerNode}>{children}</CenterSlotContext.Provider>
    </SlotContext.Provider>
  )
}

/**
 * Render this view's primary actions into the top bar. Renders nothing on the first pass (the slot
 * element does not exist yet) and portals from the second - one extra frame, invisible, and the
 * alternative is a ref that never tells anybody it was filled in.
 */
export function TopBarActions({ children }: { children: ReactNode }) {
  const node = useContext(SlotContext)
  return node ? createPortal(children, node) : null
}

/**
 * Render this view's view-switcher into the MIDDLE of the top bar. Same portal, different box: a
 * switcher is not an action, it is where you are, and it belongs between the breadcrumb that names
 * the record and the controls that act on it.
 */
export function TopBarCenter({ children }: { children: ReactNode }) {
  const node = useContext(CenterSlotContext)
  return node ? createPortal(children, node) : null
}
