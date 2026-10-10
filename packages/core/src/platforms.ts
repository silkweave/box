// Platform clients: a core port. A platform's API client (its auth, token rotation, sessions) is
// code in exactly one place, the Data Sync powerup for that platform, which registers it here at
// boot. Other recipes (Content publishing, the engagement polls) reach it only through this port,
// never through Data Sync's source, so each side stays removable: without the powerup the port
// answers "not installed" and the dependent feature says which powerup it needs.
//
// The interfaces name only what callers outside Data Sync use; a powerup's client may do more.

/** LinkedIn REST, as the Data Sync `linkedin` powerup provides it. `account` is an accounts id. */
export interface LinkedinClient {
  /** True when the account has a usable token (refreshing it if needed is the client's job). */
  authReady(account: string): boolean
  /** The member URN (`urn:li:person:...`) of the account. */
  personUrn(account?: string): string
  get<T>(path: string, account?: string): Promise<T>
  post<T = unknown>(path: string, payload: unknown, account?: string): Promise<{ id: string | null; body: T | null }>
  /** Upload an image for a post owned by `ownerUrn`; returns the image URN. */
  uploadImage(bytes: Buffer, ownerUrn: string, account?: string): Promise<string>
}

/** One Substack publication as seen through an account's signed-in session. */
export interface SubstackTarget {
  /** accounts id. */
  account: string
  /** The account's owning users.id, whose browser backs the session. */
  owner: string
  /** Publication origin, e.g. `https://acme.substack.com`. */
  publication: string
}

export interface SubstackSelfProfile {
  id: number
  handle: string
  name: string
  publicationUsers?: { publication_id: number; role: string; publication?: { subdomain?: string; name?: string } }[]
}

export interface SubstackDraft {
  id: number
  draft_title?: string | null
  title?: string | null
  slug?: string | null
  is_published?: boolean
  canonical_url?: string | null
  email_sent_at?: string | null
  post_date?: string | null
}

/** Substack's dashboard API, as the Data Sync `substack` powerup provides it. */
export interface SubstackClient {
  selfProfile(target: SubstackTarget): Promise<SubstackSelfProfile>
  createDraft(target: SubstackTarget, body: Record<string, unknown>): Promise<SubstackDraft>
  updateDraft(target: SubstackTarget, draftId: number, body: Record<string, unknown>): Promise<SubstackDraft>
  /** `send` mails the list and cannot be recalled; callers default it to false. */
  publishDraft(target: SubstackTarget, draftId: number, opts: { send: boolean }): Promise<SubstackDraft>
  uploadImage(target: SubstackTarget, dataUri: string, postId?: number): Promise<{ url: string }>
}

/** One normalized Reddit inbox notification. */
export interface RedditInboxEvent {
  /** Reddit fullname (`t1_…` comment, `t3_…` post, `t4_…` message) - the stable dedup key. */
  id: string
  kind: 'comment_reply' | 'post_reply' | 'username_mention' | 'private_message' | 'unknown'
  /** Author username, without the `/u/` prefix (empty for some system messages). */
  author: string
  /** Subreddit without the `r/` prefix, or '' for private messages. */
  subreddit: string
  permalink: string
  title: string
  /** Human-readable one-liner, e.g. "from X via r/Y sent 1 day ago: post reply". */
  summary: string
  /** ISO 8601 timestamp of the notification. */
  updated: string
}

/** Reddit, as the Data Sync `reddit` powerup provides it. */
export interface RedditClient {
  /** The account's unread inbox feed (no browser needed). */
  unreadInbox(account?: string): Promise<RedditInboxEvent[]>
}

export interface PlatformClients {
  linkedin: LinkedinClient
  substack: SubstackClient
  reddit: RedditClient
}
export type PlatformId = keyof PlatformClients

const clients = new Map<PlatformId, PlatformClients[PlatformId]>()

/** Register a platform's client. Returns the unregister function. One client per platform. */
export function registerPlatformClient<K extends PlatformId>(id: K, client: PlatformClients[K]): () => void {
  if (clients.has(id)) throw new Error(`platform client "${id}" registered twice`)
  clients.set(id, client)
  return () => {
    if (clients.get(id) === client) clients.delete(id)
  }
}

/** The platform's client, or null when its Data Sync powerup is not installed. */
export function platformClient<K extends PlatformId>(id: K): PlatformClients[K] | null {
  return (clients.get(id) as PlatformClients[K] | undefined) ?? null
}

/** The platform's client, or a refusal naming the powerup that provides it. */
export function requirePlatformClient<K extends PlatformId>(id: K): PlatformClients[K] {
  const client = platformClient(id)
  if (!client) throw new Error(`${id} is not available: add the Data Sync "${id}" powerup (recipes/data-sync/powerups/${id})`)
  return client
}

// --- published posts ------------------------------------------------------------------------------

/** A post published on a platform that some feature knows about (Content's pieces). */
export interface PublishedPost {
  /** The publishing feature's id for it (a content piece id). */
  id: string
  /** The platform's id for the post (a LinkedIn URN). */
  urn: string
  title: string
}

type PublishedPostSource = () => Promise<PublishedPost[]>
const postSources = new Map<PlatformId, PublishedPostSource[]>()

/** Register where a platform's published posts come from, so a pull can fetch per-post analytics
 *  without knowing the publishing feature. Returns the unregister function. */
export function registerPublishedPostSource(platform: PlatformId, source: PublishedPostSource): () => void {
  const list = postSources.get(platform) ?? []
  postSources.set(platform, [...list, source])
  return () => postSources.set(platform, (postSources.get(platform) ?? []).filter((s) => s !== source))
}

/** Every registered source's published posts on the platform. */
export async function publishedPosts(platform: PlatformId): Promise<PublishedPost[]> {
  const out: PublishedPost[] = []
  for (const source of postSources.get(platform) ?? []) out.push(...(await source()))
  return out
}
