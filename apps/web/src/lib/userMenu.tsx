import { Filter } from 'lucide-react'
import { AccountMenu, MenuIcon, MenuRow, MenuSwitch } from '@silkweave/box-ui'
import { useAuth } from './useAuth.tsx'
import { useActiveUser } from './useActiveUser.ts'

/**
 * This app's half of the account-menu seam: who is signed in (useAuth), where the active-user scope
 * is persisted (useActiveUser), what signing out does - and the "Only my items" filter.
 *
 * That last one used to be `filterMine` / `onFilterMine` props ON the library component: a specific
 * app FEATURE welded into the design system's account menu. It is now a row we build ourselves and
 * hand to the `extra` slot, out of the same `MenuRow`/`MenuSwitch` the built-in rows use so it
 * still looks like it belongs.
 */
export function AppUserMenu() {
  const { principal, logout } = useAuth()
  const { userId, filterMine, setActiveUser, setFilterMine } = useActiveUser()
  return (
    <AccountMenu
      principal={principal}
      onSignOut={() => void logout()}
      activeUserId={userId}
      onPickUser={setActiveUser}
      emptyHint='No users yet. Add one in Settings → Users.'
      extra={
        <>
          <MenuRow onClick={() => setFilterMine(!filterMine)}>
            <MenuIcon>
              <Filter className='size-4' />
            </MenuIcon>
            <span className='flex-1'>Only my items</span>
            <MenuSwitch on={filterMine && !!userId} />
          </MenuRow>
          {filterMine && !userId && (
            <p className='px-2 pb-1 text-label text-muted-foreground'>Pick a user to apply the filter.</p>
          )}
        </>
      }
    />
  )
}
