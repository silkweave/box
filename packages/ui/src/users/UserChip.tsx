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
 * Not for a person you already hold (`Avatar`) or a slot someone can change (`UserPicker`).
 * Props: `showName` adds the name; `unknown='id'` draws an id missing from the directory as the raw
 * id in quiet monospace (a deleted person, an outside actor) instead of nothing. Use it wherever the
 * id is a fact the reader needs (held by, called by, added by); keep the default where an empty
 * slot is the honest answer (an unassigned owner). Search text comes from `usePersonName`.
 */
export function UserChip({
  userId,
  showName = false,
  unknown = 'hide',
  className,
}: {
  userId: string | null
  showName?: boolean
  unknown?: 'hide' | 'id'
  className?: string
}) {
  const user = useUser(userId)
  if (!user) {
    if (unknown !== 'id' || !userId) return null
    return <span className={`truncate font-mono text-body-sm text-muted-foreground ${className ?? ''}`} title={`${userId} is not in this Box's directory`}>{userId}</span>
  }
  return (
    // `align-middle`: a picture has no text baseline (it sits on its bottom edge) while a letter tile
    // does, so on the baseline a person with a picture would ride 3px higher than one without.
    <span className={`inline-flex items-center gap-1.5 align-middle ${className ?? ''}`} title={userName(user)}>
      <Avatar user={user} size='xs' />
      {showName && <span className='text-body-sm text-text'>{user.nickname || userName(user)}</span>}
    </span>
  )
}
