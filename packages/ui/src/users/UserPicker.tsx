import { useState } from 'react'
import { Check, UserCircle2 } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { useUsers } from './directory.tsx'
import { userName } from './types.ts'

/**
 * Pick a user from the directory. Shows the current pick as an avatar chip; opens a popover list of
 * everyone, plus an entry for "nobody". `value` is a user id (`null` = empty); `onChange` reports
 * the picked id or `null` to clear, and the caller persists it.
 *
 * The empty entry's wording and the hint shown when the directory is empty are BOTH props: the
 * library used to hard-code "Unassigned" and "Add one in Settings → Users", the second of which is
 * a route in one particular app. A design system cannot know where your users are administered.
 */
export function UserPicker({
  value,
  onChange,
  className,
  readOnly = false,
  emptyLabel = 'Nobody',
  emptyHint,
}: {
  value: string | null
  onChange: (id: string | null) => void
  className?: string
  /** Render the chip without the picker - for a slot the viewer may see but not change. */
  readOnly?: boolean
  /** Wording for the "no user" entry, e.g. "Unassigned". */
  emptyLabel?: string
  /** Shown when the directory itself is empty. The caller knows where users come from. */
  emptyHint?: React.ReactNode
}) {
  const users = useUsers()
  const [open, setOpen] = useState(false)
  const current = users?.find((u) => u.id === value) ?? null

  const pick = (id: string | null) => {
    setOpen(false)
    if (id !== (value || null)) onChange(id)
  }

  if (readOnly) {
    return (
      <span
        className={cn('inline-flex h-7 max-w-full items-center gap-1.5 px-1.5 text-body-sm text-text', className)}
        title={current ? userName(current) : emptyLabel}>
        {current ? (
          <>
            <Avatar user={current} size='xs' />
            <span className='line-clamp-1'>{current.nickname || userName(current)}</span>
          </>
        ) : (
          <span className='inline-flex items-center gap-1.5 text-muted-foreground'>
            <UserCircle2 className='size-4' />
            <span>-</span>
          </span>
        )}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 text-body-sm text-text',
          'transition-colors outline-none hover:border-border hover:bg-accent-tint focus-visible:border-accent',
          className,
        )}
        title={current ? userName(current) : emptyLabel}>
        {current ? (
          <>
            <Avatar user={current} size='xs' />
            <span className='line-clamp-1'>{current.nickname || userName(current)}</span>
          </>
        ) : (
          <span className='inline-flex items-center gap-1.5 text-muted-foreground'>
            <UserCircle2 className='size-4' />
            <span>-</span>
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align='start' className='w-56 gap-1 p-1.5'>
        <Row selected={!value} onClick={() => pick(null)}>
          <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>
            <UserCircle2 className='size-4' />
          </span>
          <span className='flex-1 text-muted-foreground'>{emptyLabel}</span>
        </Row>
        {(users ?? []).map((u) => (
          <Row key={u.id} selected={u.id === value} onClick={() => pick(u.id)}>
            <Avatar user={u} size='xs' />
            <span className='line-clamp-1 flex-1'>{userName(u)}</span>
          </Row>
        ))}
        {users && users.length === 0 && emptyHint ? (
          <p className='px-2 py-1.5 text-label text-muted-foreground'>{emptyHint}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function Row({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-text transition-colors hover:bg-accent-tint',
        selected && 'bg-accent-tint',
      )}>
      {children}
      {selected && <Check className='size-3.5 shrink-0 text-accent' />}
    </button>
  )
}
