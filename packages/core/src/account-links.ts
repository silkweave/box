// The account directory port: how a channel links a chat (a WhatsApp group) to an organization's
// account without importing the feature that keeps accounts ("the dependent registers into the
// dependency"; docs/core/SEAM.md). CRM registers it from its server module's onModuleInit; a Box
// without CRM, or a CLI or test that never boots that module, sees no directory (null), and the
// channel shows the link as unavailable instead of failing.

export interface DirectoryAccount {
  id: string
  name: string
}

export interface AccountDirectory {
  /** Every account, ordered for a picker. */
  list(): Promise<DirectoryAccount[]>
  /** The account a chat is linked to, or null. */
  forChat(channel: string, chat: string): Promise<DirectoryAccount | null>
  /** Link a chat to an account (null unlinks it). A chat has at most one account and an account at
   *  most one chat per channel: linking moves the link. Throws when the channel has no such link. */
  linkChat(channel: string, chat: string, accountId: string | null): Promise<void>
}

let directory: { id: string; port: AccountDirectory } | null = null

/** Register the account directory. One per Box; returns the unregister function. */
export function registerAccountDirectory(id: string, port: AccountDirectory): () => void {
  if (directory) throw new Error(`account directory registered twice ("${directory.id}", then "${id}")`)
  const entry = { id, port }
  directory = entry
  return () => {
    if (directory === entry) directory = null
  }
}

/** The account directory, or null when no feature in this process keeps accounts. */
export const accountDirectory = (): AccountDirectory | null => directory?.port ?? null
