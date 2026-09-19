import { createContext } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@silkweave/box-ui'
import { usePersistedState } from '@silkweave/box-ui/lib'
import { appKey } from './storage.ts'

/**
 * "Show the non-current items too" - the app-level switch behind the eye on a sidebar group header.
 *
 * This lived in `@silkweave/box-ui` until 2026-09-14 and had no business being there. It is
 * application state in three separate ways: it PERSISTS a preference (under a key the library
 * invented), it names an application concept ("show all"), and what counts as non-current is a
 * decision each feature makes for itself - Initiatives hides everything but planned/active,
 * Content hides completed pieces, Engagement hides handled replies. A component library cannot hold
 * any of that. What came back the other way is nothing: the eye is `<Button variant='ghost'
 * size='icon-xs' aria-pressed={...}>`, which the library already had.
 */

/**
 * Whether a section shows its non-current items. Each layout owns the toggle and provides the
 * value; the section's grid and sidebar consume it. Defaults to true so anything rendered outside a
 * provider hides nothing.
 */
export const ShowAllContext = createContext(true)

/** Persisted per section, so the choice survives a reload and does not leak between features. */
export function useShowAll(section: string): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  return usePersistedState(appKey(section, 'showAll'), false, (v) => typeof v === 'boolean')
}

/**
 * The eye on a sidebar group header, and its bordered sibling for a section heading.
 *
 * Both are `Button` with `aria-pressed` - no library component needed. What lives here rather than
 * there is the POLICY: composing the English label out of a count and a noun, and hiding the
 * control entirely when there is nothing to reveal and nothing currently revealed. A design system
 * must not decide when it is pointless to render.
 */
interface RevealProps {
  shown: boolean
  onToggle: () => void
  /** How many items are hidden while `shown` is false. */
  hiddenCount: number
  /** What the hidden things are called, e.g. "done initiatives". */
  noun: string
}

const revealLabel = ({ shown, hiddenCount, noun }: RevealProps) =>
  shown ? `Hide ${noun}` : `Show ${hiddenCount} ${noun}`

/** Icon-only, for `AppShell`'s `groupAction` slot. */
export function ShowAllEye(props: RevealProps) {
  if (props.hiddenCount === 0 && !props.shown) return null
  const label = revealLabel(props)
  const Icon = props.shown ? Eye : EyeOff
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      onClick={props.onToggle}
      aria-pressed={props.shown}
      aria-label={label}
      title={label}>
      <Icon />
    </Button>
  )
}

/** Bordered, for a section heading where the switch sits beside other controls. */
export function ShowAllButton(props: RevealProps) {
  if (props.hiddenCount === 0 && !props.shown) return null
  const label = revealLabel(props)
  const Icon = props.shown ? Eye : EyeOff
  return (
    <Button
      variant='outline'
      size='icon-sm'
      onClick={props.onToggle}
      aria-pressed={props.shown}
      aria-label={label}
      title={label}>
      <Icon />
    </Button>
  )
}
