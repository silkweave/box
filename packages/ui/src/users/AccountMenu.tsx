import { useState } from 'react'
import type * as React from 'react'
import { Check, LogOut, UserCircle2 } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { useUsers, useUser } from './directory.tsx'
import { userName } from './types.ts'

export interface AccountMenuProps {
  /** The signed-in principal; null when the Box runs without auth and the menu is a picker instead. */
  principal: { id: string; display: string } | null
  onSignOut: () => void
  /** The persisted active user (locked to the principal when signed in). */
  activeUserId: string | null
  onPickUser: (id: string | null) => void
  /** Shown when the directory itself is empty. The caller knows where users are administered. */
  emptyHint?: React.ReactNode
  /**
   * Extra rows below a separator, for whatever this app hangs off its account menu. Build them with
   * the exported `MenuRow` / `MenuSwitch` so they match.
   *
   * This slot exists because the menu used to hard-code a "Only my items" filter with its own
   * `filterMine` / `onFilterMine` props - a specific app FEATURE welded into the shell's account
   * menu. The shape (an avatar trigger over an identity block and a sign-out) is general; what a
   * given Box hangs underneath it is not.
   */
  extra?: React.ReactNode
}

/**
 * The top-right account menu: who is operating this Box, and how to stop.
 *
 * Props rather than the context the pickers use: this renders exactly once, from the app's shell
 * adapter, and every one of its inputs (who is signed in, what "sign out" means, where the active
 * user is persisted) is a policy the library should not hold an opinion about. Only the directory
 * itself comes from the context, which the pickers need anyway.
 */
export function AccountMenu({
  principal,
  onSignOut,
  activeUserId,
  onPickUser,
  emptyHint,
  extra,
}: AccountMenuProps) {
  const users = useUsers()
  const user = useUser(activeUserId)
  const userId = activeUserId
  const [open, setOpen] = useState(false)

  // When signed in (auth enforced), the active user is LOCKED to the authenticated principal - hide
  // the picker + "no active user", and offer Sign out instead.
  const signedIn = principal != null

  const pick = (id: string | null) => {
    setOpen(false)
    onPickUser(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* JUST THE FACE (2026-08-12). The name rode beside it, which cost up to 96px of the top bar
          to tell you something you already know - you are the one operating - and made the control
          change width when you switched user. The name is one click away, at the top of the popup. */}
      <PopoverTrigger
        aria-label={user ? `Operating as ${userName(user)}` : signedIn ? `Signed in as ${principal.display}` : 'Pick who is operating'}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-text',
          'transition-opacity outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/50',
        )}
        title={user ? `Operating as ${userName(user)}` : signedIn ? `Signed in as ${principal.display}` : 'No active user - pick who is operating'}>
        {user ? (
          <Avatar user={user} size='nav' />
        ) : (
          <UserCircle2 className='size-7 text-muted-foreground' strokeWidth={1.5} />
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-60 gap-1 p-1.5'>
        <p className='px-2 pt-1 pb-0.5 text-label text-muted-foreground'>{signedIn ? 'Signed in as' : 'Operating as'}</p>
        {signedIn ? (
          <>
            {user ? (
              <div className='flex items-center gap-2 px-2 py-1.5 text-body-sm text-text'>
                <Avatar user={user} size='xs' />
                <span className='line-clamp-1 flex-1'>{userName(user)}</span>
              </div>
            ) : (
              <div className='flex items-center gap-2 px-2 py-1.5 text-body-sm text-text'>
                <UserCircle2 className='size-4 text-muted-foreground' />
                <span className='line-clamp-1 flex-1'>{principal.display}</span>
              </div>
            )}
            <MenuRow
              selected={false}
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}>
              <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>
                <LogOut className='size-4' />
              </span>
              <span className='flex-1'>Sign out</span>
            </MenuRow>
          </>
        ) : (
          <>
            {(users ?? []).map((u) => (
              <MenuRow key={u.id} selected={u.id === userId} onClick={() => pick(u.id)}>
                <Avatar user={u} size='xs' />
                <span className='line-clamp-1 flex-1'>{userName(u)}</span>
              </MenuRow>
            ))}
            <MenuRow selected={!userId} onClick={() => pick(null)}>
              <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>
                <UserCircle2 className='size-4' />
              </span>
              <span className='flex-1 text-muted-foreground'>No active user</span>
            </MenuRow>
            {users && users.length === 0 && emptyHint ? (
              <p className='px-2 py-1.5 text-label text-muted-foreground'>{emptyHint}</p>
            ) : null}
          </>
        )}
        {extra ? (
          <>
            <div className='my-1 border-t border-border' />
            {extra}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A row in the menu. Exported so an app's `extra` rows are the same object as the built-in ones -
 * otherwise the separator would have a different-looking list under it.
 */
export function MenuRow({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
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

/** The menu's switch affordance, for an `extra` row that toggles something. Presentational only. */
export function MenuSwitch({ on }: { on: boolean }) {
  return (
    <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-border')}>
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-3 rounded-full bg-surface transition-transform',
          on && 'translate-x-3',
        )}
      />
    </span>
  )
}

/** The leading icon slot of a `MenuRow`, sized to line up with the avatars. */
export function MenuIcon({ children }: { children: React.ReactNode }) {
  return <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>{children}</span>
}
