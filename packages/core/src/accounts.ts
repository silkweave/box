// Channel account definitions from the merged Box configuration.
import { boxJson } from './box-config.js'

export interface ChannelAccount {
  /** Short account id - becomes the channel suffix ('bob' → 'github@bob'). */
  id: string
  /** The owning users.id (Settings → Users). Drives signal-owner resolution. */
  user: string
  /** The default account keeps the bare, unsuffixed channel (legacy signal ids stay put). */
  default?: boolean
  /** Platform login (GitHub login, X handle, …). Empty = placeholder, pulls skip it. */
  login: string
  /** Org to snapshot alongside the user (GitHub org slug; LinkedIn organization id). Optional. */
  org?: string
  /**
   * Substack: the publication ORIGIN this account publishes to, e.g.
   * `https://acme.substack.com`. It is not derivable from `login` - a publication's subdomain is
   * independent of the user handle, and a publication on a custom domain answers the API on that
   * domain instead - so it is configured rather than guessed. See pulls/substack-client.ts.
   */
  publication?: string
  /**
   * Blog: the RSS/Atom feed URL this account publishes to, e.g. `https://acme.dev/rss.xml`. Same
   * reasoning as `publication` above - a feed path is not derivable from a login, every blog engine
   * puts it somewhere different, and a redirecting apex host makes even the origin a guess - so it
   * is configured rather than assumed. Absent or empty means the blog pull has no feed to fetch and
   * says so; there is no default, because the only default available would be somebody else's blog.
   * See pulls/blog.ts and blog-feed.ts.
   */
  feed?: string
  /**
   * Terms a site-wide search should treat as "someone is talking about us" - product names, the
   * company name, anything a stranger would type. Configured rather than derived from `login`: a
   * handle is who we POST as, and the words people use about us are usually neither that nor each
   * other. Used by the Hacker News pull; empty or absent means "search for nothing", which is a
   * legitimate state for a Box that only wants its own submissions back.
   */
  mentionTerms?: string[]
  /** GitHub: repos (owner/name) to track stars/traffic for. */
  repos?: string[]
  /** GitHub: search query counting external OSS PRs authored (optional). */
  ossPrQuery?: string
}

export type AccountsFile = Record<string, ChannelAccount[]>

export function readAccountsFile(): AccountsFile {
  return boxJson().accounts as AccountsFile
}

/** All accounts configured for a base channel (e.g. 'github'), default first. */
export function channelAccounts(baseChannel: string): ChannelAccount[] {
  const list = readAccountsFile()[baseChannel] ?? []
  return [...list].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false))
}

/** The default account for a base channel. Throws when the channel has none configured. */
export function defaultAccount(baseChannel: string): ChannelAccount {
  const acct = channelAccounts(baseChannel).find((a) => a.default)
  if (!acct) throw new Error(`no default account for channel "${baseChannel}" - add one to box.json accounts`)
  return acct
}

/** The warehouse/dashboard channel string for an account: bare for the default, '@'-suffixed else. */
export function accountChannel(baseChannel: string, account: ChannelAccount): string {
  return account.default ? baseChannel : `${baseChannel}@${account.id}`
}

/** Split a channel string into its base + account id ('github@bob' → ['github', 'bob']). */
export function splitChannel(channel: string): { base: string; account: string | null } {
  const at = channel.indexOf('@')
  return at === -1 ? { base: channel, account: null } : { base: channel.slice(0, at), account: channel.slice(at + 1) }
}

/** The users.id bound to an @-suffixed channel via accounts.json, or null. */
export function channelAccountUser(channel: string): string | null {
  const { base, account } = splitChannel(channel)
  if (!account) return null
  return readAccountsFile()[base]?.find((a) => a.id === account)?.user ?? null
}

/**
 * The identity PLATFORM behind a channel. `linkedin-article` (newsletter long-form) is a distinct
 * CONTENT channel - format, limits, and publish path all differ from `linkedin` posts - but the
 * platform is the same: one login, one `users.channels` handle, one credentials.json entry, one
 * browser session. Anything keyed by identity (handles, credentials, browsers, verify strategies)
 * must key by platform, never by the content channel.
 */
export function channelPlatform(channel: string): string {
  return channel === 'linkedin-article' ? 'linkedin' : channel
}
