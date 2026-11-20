import { useState } from 'react'
import { ChevronsUpDown, UserCircle2 } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { OptionList } from '../components/OptionList.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { useFieldControl } from '../components/Field.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { useUsers } from './directory.tsx'
import { userName } from './types.ts'

/**
 * Pick a user from the directory. Shows the current pick as an avatar chip; opens a popover list of
 * everyone, plus an entry for "nobody" (an `OptionList`: capped height, search past five people). `value` is a user id (`null` = empty); `onChange` reports
 * the picked id or `null` to clear, and the caller persists it.
 *
 * The empty entry's wording and the hint shown when the directory is empty are BOTH props: the
 * library used to hard-code "Unassigned" and "Add one in Settings → Users", the second of which is
 * a route in one particular app. A design system cannot know where your users are administered.
 * Not for display only (`UserChip`, or `readOnly` where the slot is editable for others).
 */
export function UserPicker({
  value,
  onChange,
  className,
  readOnly = false,
  emptyLabel = 'Nobody',
  emptyHint,
  caret = false,
  showEmptyLabel = false,
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
  /** A trailing chevron at rest, so a table cell reads as a picker before it is hovered. */
  caret?: boolean
  /** Show `emptyLabel` at rest when nobody is picked (a settings row), instead of a dash (a table cell). */
  showEmptyLabel?: boolean
}) {
  const users = useUsers()
  const [open, setOpen] = useState(false)
  const field = useFieldControl()
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
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
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
            <span>{showEmptyLabel ? emptyLabel : '-'}</span>
          </span>
        )}
        {caret && <ChevronsUpDown className='ml-auto size-3.5 shrink-0 text-muted-foreground' />}
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 gap-1 p-1.5'>
        <OptionList
          value={value || ''}
          onPick={(id) => pick(id || null)}
          searchLabel='Search people'
          placeholder='Search people…'
          emptyLabel={users && users.length === 0 && emptyHint ? emptyHint : 'Nobody matches.'}
          items={[
            {
              value: '',
              text: emptyLabel,
              label: (
                <>
                  <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>
                    <UserCircle2 className='size-4' />
                  </span>
                  <span className='flex-1 text-muted-foreground'>{emptyLabel}</span>
                </>
              ),
            },
            ...(users ?? []).map((u) => ({
              value: u.id,
              text: `${userName(u)} ${u.nickname}`,
              label: (
                <>
                  <Avatar user={u} size='xs' />
                  <span className='line-clamp-1 flex-1'>{userName(u)}</span>
                </>
              ),
            })),
          ]}
        />
      </PopoverContent>
    </Popover>
  )
}
