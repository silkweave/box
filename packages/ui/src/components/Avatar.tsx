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

export function Avatar({
  user,
  size = 'md',
  className,
}: {
  user: AvatarUser
  size?: keyof typeof SIZES
  className?: string
}) {
  const cls = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium', SIZES[size], className)
  if (user.image) return <img src={user.image} alt={userName(user)} className={cls} />
  return (
    <span className={cn(cls, tintFor(user.id))} aria-hidden>
      {initials(user)}
    </span>
  )
}
