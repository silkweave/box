import { Avatar } from '../components/Avatar.tsx'
import { useUser } from './directory.tsx'
import { userName } from './types.ts'

/**
 * A user id, drawn. Resolves the id through the `UsersProvider` directory and renders the avatar
 * (plus the name, with `showName`); renders nothing when the id is null or unknown.
 *
 * This was `OwnerAvatar` until 2026-09-14. "Owner" is a ROLE the app assigns - the same chip draws
 * an assignee, an author, a `triggered_by`, a `created_by` and a reviewer, and none of that is
 * visible from here. What the component knows is: given an id, show the person.
 */
export function UserChip({
  userId,
  showName = false,
  className,
}: {
  userId: string | null
  showName?: boolean
  className?: string
}) {
  const user = useUser(userId)
  if (!user) return null
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`} title={userName(user)}>
      <Avatar user={user} size='xs' />
      {showName && <span className='text-body-sm text-text'>{user.nickname || userName(user)}</span>}
    </span>
  )
}
