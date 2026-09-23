import { createHmac, randomBytes } from 'node:crypto'

/** The minimum identity the stable supervisor needs while the Box app is repairing itself. */
export interface BuilderSupervisorPrincipal {
  id: string
  display: string
  role: 'admin' | 'member'
}

/** A verifier result must distinguish an unavailable child from an authenticated non-admin. */
export type BuilderSupervisorVerification = BuilderSupervisorPrincipal | 'deny' | 'unavailable'

export interface BuilderSupervisorAuthOptions {
  /** Maximum time an already-authenticated admin may repair through an app outage. */
  leaseMs?: number
  /** Injected for deterministic tests and a clear clock boundary. */
  now?: () => number
  /** Process-local HMAC key. Omit to generate one; it is never persisted or returned. */
  cacheKey?: Uint8Array
}

export type BuilderSupervisorAuthResult =
  | {
      ok: true
      principal: BuilderSupervisorPrincipal
      source: 'healthy' | 'recovery'
      expiresAt: number
    }
  | {
      ok: false
      state: 'denied' | 'unavailable'
      reason: 'missing_cookie' | 'not_admin' | 'revoked' | 'app_unavailable' | 'lease_expired'
    }

const DEFAULT_LEASE_MS = 15 * 60_000

const validPrincipal = (value: BuilderSupervisorVerification): value is BuilderSupervisorPrincipal =>
  typeof value === 'object' && value !== null && typeof value.id === 'string' && value.id.length > 0 &&
  typeof value.display === 'string' && (value.role === 'admin' || value.role === 'member')

/**
 * Auth state for a stable Builder supervisor.
 *
 * The supervisor calls `authenticate` with the browser's existing Box session cookie. While the
 * child is healthy, its verifier calls `/api/auth/me` and the result is authoritative. An admin
 * result creates or refreshes a short lease. `unavailable` is the only result that may use that
 * lease, and it never extends it. An explicit `deny` (including a healthy member, revoked user,
 * logout, or malformed response) destroys the lease immediately.
 *
 * This class deliberately has no database, token, cookie parser, or login path. A cold supervisor
 * cannot authenticate a new browser while the child is down; the host recovery path must handle
 * that case. The raw session cookie is never retained, only an in-memory process-local HMAC digest.
 */
export class BuilderSupervisorAuth {
  readonly #leaseMs: number
  readonly #now: () => number
  readonly #cacheKey: Uint8Array
  readonly #leases = new Map<string, { principal: BuilderSupervisorPrincipal; expiresAt: number }>()

  constructor(
    private readonly verify: (sessionCookie: string) => Promise<BuilderSupervisorVerification> | BuilderSupervisorVerification,
    options: BuilderSupervisorAuthOptions = {},
  ) {
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('Builder supervisor lease must be a positive integer')
    this.#leaseMs = leaseMs
    this.#now = options.now ?? Date.now
    this.#cacheKey = options.cacheKey ?? randomBytes(32)
  }

  /** Authenticate or revalidate one browser connection. Call this periodically for open sockets. */
  async authenticate(sessionCookie: string | undefined): Promise<BuilderSupervisorAuthResult> {
    if (!sessionCookie) return { ok: false, state: 'denied', reason: 'missing_cookie' }
    const key = this.#key(sessionCookie)
    const checked = await this.verify(sessionCookie)
    const now = this.#now()

    if (validPrincipal(checked) && checked.role === 'admin') {
      const expiresAt = now + this.#leaseMs
      this.#leases.set(key, { principal: checked, expiresAt })
      return { ok: true, principal: checked, source: 'healthy', expiresAt }
    }

    if (checked === 'unavailable') {
      const lease = this.#leases.get(key)
      if (lease && lease.expiresAt > now) {
        return { ok: true, principal: lease.principal, source: 'recovery', expiresAt: lease.expiresAt }
      }
      if (lease) this.#leases.delete(key)
      return { ok: false, state: 'unavailable', reason: lease ? 'lease_expired' : 'app_unavailable' }
    }

    this.#leases.delete(key)
    return {
      ok: false,
      state: 'denied',
      reason: validPrincipal(checked) ? 'not_admin' : 'revoked',
    }
  }

  /** Invalidate a browser's cached recovery lease after the supervisor observes logout. */
  logout(sessionCookie: string | undefined): void {
    if (sessionCookie) this.#leases.delete(this.#key(sessionCookie))
  }

  /** Invalidate every cached lease, useful when the supervisor itself rotates its process state. */
  clear(): void {
    this.#leases.clear()
  }

  #key(sessionCookie: string): string {
    return createHmac('sha256', this.#cacheKey).update(sessionCookie).digest('base64url')
  }
}

export const BUILDER_SUPERVISOR_LEASE_MS = DEFAULT_LEASE_MS
