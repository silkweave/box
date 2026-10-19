import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import type { NavGroup } from './Sidebar.tsx'
import { layoutOf, orderGroups, sectionKeys, sectionOf, type SidebarCustomization } from './sidebarLayout.ts'

const SECTION_ID = 'section:'

/** Rows move up and down only: a sideways pull would scroll the sidebar instead of reordering. */
const VERTICAL: Modifier[] = [({ transform }) => ({ ...transform, x: 0 })]
/** And auto-scroll follows only the vertical edge. */
const AUTO_SCROLL = { threshold: { x: 0, y: 0.2 } }

/**
 * The sidebar in customize mode: every group in its place, the hidden ones muted. Drag sections,
 * drag groups within their section, hide and show groups. Every change is stored at once through
 * `onChange`.
 */
export function SidebarCustomize({ groups, customization }: { groups: readonly NavGroup[]; customization: SidebarCustomization }) {
  const { layout, onChange } = customization
  const ordered = orderGroups(groups, layout)
  const hidden = (layout?.hidden ?? []).filter((id) => ordered.some((g) => g.id === id))
  const sections = sectionKeys(ordered)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const store = (next: NavGroup[], nextHidden: string[]) => onChange(layoutOf(next, nextHidden, layout))
  const toggle = (id: string) => store(ordered, hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])

  const moveSection = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    // Section ids carry a prefix: a section without a heading has the key '', which is no drag id.
    const at = (id: unknown) => sections.indexOf(String(id).slice(SECTION_ID.length))
    const moved = arrayMove(sections, at(active.id), at(over.id))
    store(moved.flatMap((s) => ordered.filter((g) => sectionOf(g) === s)), hidden)
  }
  const moveGroup = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    // Each section has its own drag context, so both ids are always in the same section.
    const ids = ordered.map((g) => g.id)
    store(arrayMove(ordered, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))), hidden)
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={VERTICAL} autoScroll={AUTO_SCROLL} onDragEnd={moveSection}>
        <SortableContext items={sections.map((s) => SECTION_ID + s)} strategy={verticalListSortingStrategy}>
          {sections.map((section, index) => (
            <SortableSection key={section || '(none)'} id={SECTION_ID + section} heading={section || 'Other'} first={index === 0}>
              <SectionGroups members={ordered.filter((g) => sectionOf(g) === section)} hidden={hidden} sensors={sensors} onDragEnd={moveGroup} onToggle={toggle} />
            </SortableSection>
          ))}
        </SortableContext>
      </DndContext>

      {layout && (
        <div className='px-1 pt-5'>
          <button
            type='button'
            onClick={() => onChange(null)}
            className='rounded-md px-1.5 text-label font-medium text-muted-foreground transition-colors duration-[120ms] hover:text-text'>
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}

/** One section's groups, sortable among themselves only: each section has its own drag context. */
function SectionGroups({
  members,
  hidden,
  sensors,
  onDragEnd,
  onToggle,
}: {
  members: NavGroup[]
  hidden: readonly string[]
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (e: DragEndEvent) => void
  onToggle: (id: string) => void
}) {
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={VERTICAL} autoScroll={AUTO_SCROLL} onDragEnd={onDragEnd}>
      <SortableContext items={members.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        {members.map((g) => (
          <SortableGroup key={g.id} group={g} hidden={hidden.includes(g.id)} onToggle={() => onToggle(g.id)} />
        ))}
      </SortableContext>
    </DndContext>
  )
}

/** A section heading, styled as the sidebar's own. */
function SectionHeading({ first, drag, children }: { first: boolean; drag?: DragHandle; children: ReactNode }) {
  return (
    <h2 className={cn('px-1', first ? 'pt-1' : 'pt-5', 'pb-1.5')}>
      <span
        ref={drag?.ref}
        {...drag?.props}
        className={cn('flex w-full items-center gap-1 rounded-md px-1.5 text-left text-label font-medium text-muted-foreground', drag && DRAG)}>
        <span className='flex-1 truncate'>{children}</span>
        {drag && <GripVertical aria-hidden className='size-3.5 shrink-0 opacity-60' />}
      </span>
    </h2>
  )
}

/** A group row, styled as the sidebar's own; `children` are its controls at the right. */
function GroupRow({ group, muted = false, drag, children }: { group: NavGroup; muted?: boolean; drag?: DragHandle; children: ReactNode }) {
  const Icon = group.icon
  return (
    <div className='rounded-lg border border-transparent p-1'>
      <div className={cn('flex w-full items-center rounded-md text-body-sm hover:bg-accent-tint', muted ? 'text-muted-foreground' : 'text-text')}>
        <span ref={drag?.ref} {...drag?.props} className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left', muted && 'opacity-50', drag && DRAG)}>
          <Icon className='size-4 shrink-0 text-muted-foreground' />
          <span className='line-clamp-1 flex-1'>{group.label}</span>
        </span>
        <span className='mr-1.5 flex shrink-0 items-center'>{children}</span>
      </div>
    </div>
  )
}

const DRAG = 'cursor-grab touch-none active:cursor-grabbing'

interface DragHandle {
  ref: (node: HTMLElement | null) => void
  props: Record<string, unknown>
}

/** The sortable bits of a row: its node, its drag handle, and the lift while it moves. */
function useSortableRow(id: string, label: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    className: cn(isDragging && 'relative z-10 rounded-lg bg-sidebar shadow-(--shadow-md)'),
    drag: { ref: setActivatorNodeRef, props: { ...attributes, ...listeners, 'aria-label': label, title: 'Drag to reorder' } } as DragHandle,
  }
}

function SortableSection({ id, heading, first, children }: { id: string; heading: string; first: boolean; children: ReactNode }) {
  const row = useSortableRow(id, `Move section ${heading}`)
  return (
    <div ref={row.ref} style={row.style} className={row.className}>
      <SectionHeading first={first} drag={row.drag}>
        {heading}
      </SectionHeading>
      {children}
    </div>
  )
}

function SortableGroup({ group, hidden, onToggle }: { group: NavGroup; hidden: boolean; onToggle: () => void }) {
  const row = useSortableRow(group.id, `Move ${group.label}`)
  return (
    <div ref={row.ref} style={row.style} className={row.className}>
      <GroupRow group={group} muted={hidden} drag={row.drag}>
        <ToggleButton label={hidden ? `Show ${group.label}` : `Hide ${group.label}`} onClick={onToggle}>
          {hidden ? <Eye className='size-3.5' /> : <EyeOff className='size-3.5' />}
        </ToggleButton>
      </GroupRow>
    </div>
  )
}

function ToggleButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className='flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-text'>
      {children}
    </button>
  )
}
