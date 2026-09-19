import { randomUUID } from 'node:crypto'
import { boxJson, defaultBoxJson } from '@silkweave/box-core'

/**
 * Is `127.0.0.1:<our port>` actually US?
 *
 * WHY THIS EXISTS, in full, because the failure it prevents is invisible by construction.
 *
 * On 2026-09-02 a workstation was connected to the production host over VS Code Remote-SSH, which
 * scans the remote for listening ports and forwards them onto LOCAL 127.0.0.1. It forwarded the
 * PRODUCTION server onto 127.0.0.1:8080. The dev server was also on 8080 - but Node binds the IPv6
 * wildcard (`::`), and the tunnel had bound IPv4 `127.0.0.1`, so the two coexisted with no
 * EADDRINUSE and no log line anywhere. Chrome resolves `localhost` to `::1`, so the dashboard was
 * talking to dev and looked completely normal. The chat agent's session dials the LITERAL
 * `127.0.0.1:8080/mcp` from its own config - so every MCP write from a "local" agent turn went to
 * PRODUCTION. Asking the agent to create a channel on dev created it in production.
 *
 * Nothing in the config was wrong; the URL was correct and the comment above it said exactly the
 * right thing. What was missing was anybody checking that the address still means what it says.
 *
 * The check is a nonce, not a hostname or a port: this process mints `INSTANCE_ID` at import and
 * serves it at `/api/auth/instance`, so "is that me?" is a string comparison that cannot be faked by
 * another Box, a proxy, or a tunnel to a machine running this same code.
 *
 * RE-CHECKED, not checked once at boot, because the hazard is DYNAMIC: the tunnel appears when the
 * editor reconnects and vanishes when it drops, both while this server keeps running. The result is cached
 * only briefly - long enough that a burst of turns costs one probe.
 */
export const INSTANCE_ID = randomUUID()

/** How long a verdict is trusted. Short, because a tunnel can appear mid-session. */
const CACHE_MS = 15_000
/** A probe that hangs must not hang a turn; a loopback request that is slow is already wrong. */
const TIMEOUT_MS = 2_000

export interface LoopbackVerdict {
  /** True when 127.0.0.1:<port> answered with OUR instance id. */
  ours: boolean
  /** One line for a log or a channel, when it is not ours. */
  detail: string
}

let cached: { at: number; verdict: LoopbackVerdict } | undefined

/**
 * The port this process serves on when `PORT` says nothing. **8190** (2026-09-13), and the reason is
 * the story above, one step on.
 *
 * It was 8080, then 8090, and is now 8190. Each move was the same lesson: a DEFAULT port that
 * something else on the machine also wants is how two instances of this code end up sharing an
 * address. 8080 is crowded on any dev machine, and it is the port Remote-SSH forwarded production
 * onto in the incident above. 8090 then turned out to be crowded in exactly the same way by
 * another checkout of this same code.
 *
 * The general rule, which is the part worth keeping: **a second Box must never be one default
 * away from the first.** Two Boxes on one machine sharing a default either collide loudly
 * (recoverable) or sit beside each other on different address families and get mistaken for one
 * another (not recoverable - that is the 2026-09-02 incident). Set `PORT` (and `BOX_VITE_PORT`)
 * explicitly for every Box after the first, and leave this guard on.
 *
 * `main.ts` imports this rather than spelling the number again - a listen port and the port the
 * loopback guard probes that disagree would make the guard answer about a process that isn't us.
 *
 * Since 2026-09-18 the number itself is core's default for `server.port` in `box.json`
 * (packages/core/src/box-json.ts), which the vite config and the `box` CLI read too; this constant
 * is that value under the name the rest of the server knows.
 */
export const DEFAULT_PORT: number = defaultBoxJson().server.port

/** The port this process serves on: `PORT` in the environment, else `server.port` in box.json. */
export const servicePort = (): number => boxJson().server.port

/**
 * Ask 127.0.0.1 who it is. Never throws: an unreachable loopback is a verdict, not an exception.
 *
 * A FAILED probe counts as "not ours" deliberately. The whole point is to gate credentialed writes
 * on a positive identification, and "I could not tell" is not one - refusing costs a retry, while
 * guessing costs a write to somebody else's database.
 */
export async function verifyLoopback(port: number = servicePort()): Promise<LoopbackVerdict> {
  const now = Date.now()
  if (cached !== undefined && now - cached.at < CACHE_MS) return cached.verdict
  const verdict = await probe(port)
  cached = { at: now, verdict }
  return verdict
}

async function probe(port: number): Promise<LoopbackVerdict> {
  const url = `http://127.0.0.1:${port}/api/auth/instance`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      return { ours: false, detail: `${url} answered HTTP ${response.status}, not this server` }
    }
    const body = (await response.json()) as { instance?: unknown }
    if (body.instance === INSTANCE_ID) return { ours: true, detail: 'loopback is this instance' }
    return {
      ours: false,
      detail:
        typeof body.instance === 'string'
          ? `${url} is ANOTHER Box instance (a port-forward or a second server) - not this one`
          : `${url} answered something that is not a Box instance`
    }
  } catch (error) {
    return { ours: false, detail: `${url} did not answer (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** Forget the cached verdict - for a boot probe that wants a fresh answer. */
export const forgetLoopbackVerdict = (): void => {
  cached = undefined
}
