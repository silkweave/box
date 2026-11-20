import { cn } from '../lib/utils.ts'
import { userName, type AvatarUser } from '../users/types.ts'

// A small user avatar: the image when set, else a deterministic initials chip from the nickname/name.
// Reused everywhere a user shows (the Users page cards, the owner/assignee pickers).

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-[11px]',
  /** 28px - the top bar's user control, where the avatar IS the button (no name beside it) and so
   *  has to be a hit target rather than a decoration. */
  nav: 'size-7 text-[11px]',
  md: 'size-8 text-body-sm',
  lg: 'size-12 text-body-md',
} as const

// A fixed palette of tints (semantic color tokens); pick by a stable hash of the id.
const TINTS = [
  'bg-accent/15 text-accent',
  'bg-success/15 text-success',
  'bg-info/15 text-info',
  'bg-warning/20 text-warning',
  'bg-danger/15 text-danger',
  'bg-muted text-muted-foreground',
]

function initials(u: AvatarUser): string {
  const a = u.first_name.trim()[0] ?? ''
  const b = u.last_name.trim()[0] ?? ''
  const ab = (a + b).trim()
  return (ab || u.nickname.trim().slice(0, 2) || u.id.slice(0, 2)).toUpperCase()
}

function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TINTS[Math.abs(h) % TINTS.length]
}

/** The letter tile's sizes: rounded squares, so a service never reads as a person. */
const LETTER_SIZES = {
  sm: 'size-6 rounded-md text-[11px]',
  md: 'size-8 rounded-lg text-body',
  lg: 'size-12 rounded-lg text-display-sm',
} as const

type UserAvatarProps = { user: AvatarUser; size?: keyof typeof SIZES; label?: never; className?: string }
type LetterAvatarProps = { label: string; size?: keyof typeof LETTER_SIZES; user?: never; className?: string }

/**
 * A user's avatar, or a letter tile for a thing that is not a person.
 *
 * `user`: their image, else initials on a tint chosen by a stable hash of the id. Use it wherever a
 * person you already hold as an `AvatarUser` shows, beside or instead of the name. Not for a bare
 * user id (`UserChip` resolves it through the directory).
 * `label`: the first letter of the label on an accent-tinted rounded square, the media of a
 * connected service, channel, mailbox or server (an MCP server row, its detail header). Not for a
 * thing that has its own icon (draw the icon) or a state (`StatusDot`).
 * `size`: users `xs`/`sm` in dense rows and chips, `nav` (28px) where the avatar is itself the
 * button, `md` by default, `lg` for a detail header's media slot; letter tiles `sm`, `md`, `lg`.
 * Rule: initials and letters are `aria-hidden`, so the name must be in text beside it or on its
 * control.
 */
export function Avatar(props: UserAvatarProps | LetterAvatarProps) {
  if (props.label !== undefined) {
    const { label, size = 'md', className } = props
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center border border-border bg-accent-tint font-medium text-accent',
          LETTER_SIZES[size],
          className,
        )}>
        {(label.trim()[0] ?? '?').toUpperCase()}
      </span>
    )
  }
  const { user, size = 'md', className } = props as UserAvatarProps
  const cls = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium', SIZES[size], className)
  if (user.image) return <img src={user.image} alt={userName(user)} className={cls} />
  return (
    <span className={cn(cls, tintFor(user.id))} aria-hidden>
      {initials(user)}
    </span>
  )
}
