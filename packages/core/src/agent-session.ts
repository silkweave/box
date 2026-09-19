// Who may reach a worker session through the /agent mount (chat Track 20, 2026-09-02; made a port
// on 2026-09-13).
//
// Here for two reasons. @silkweave/box-core is the only package with tests, and this is an ACCESS
// rule - the one kind of rule where a mistake is an escalation rather than a bug. And it is CORE,
// not chat's: the agent host is part of a blank Box, so it cannot import a feature. It used to -
// `workerdeck.host.ts` imported `chatStore` for the room predicate, which meant `rm -rf` of the
// chat feature broke a file outside every feature directory.
//
// The inversion is the standard one (SEAM: dependents register into dependencies). Core knows one
// rule, ownership, and it is the only rule a featureless Box needs. Anything that WIDENS access
// beyond the owner is a rule a feature registers - today exactly one, chat's "a room's readers may
// read that room's agent turn" (`features/chat/agent-session-access.ts`). With no feature
// installed the registry is empty and every non-owner is `none`, which is the correct answer.

/**
 * The value every session this Box creates carries as `meta.app`.
 *
 * It is how a worker session is recognised as OURS - the orphan sweep, the sidebar's session list
 * and `agentRoomOf` all filter on it, because a workerdeck instance may host sessions this Box did
 * not create and must not adopt them. One constant rather than a literal at each site: the three
 * filters and the two creators have to agree exactly, and a typo in any one of them is silent (it
 * sees nothing, or it sweeps nothing).
 *
 * The web SPA mirrors this value as a literal - it does not depend on @silkweave/box-core. Keep
 * the two in step, the same arrangement `packages/cli` has with DEFAULT_PORT.
 */
export const AGENT_SESSION_APP = 'box'

/**
 * The two fields of a workerdeck `SessionInfo` these rules read. Structural rather than the
 * protocol type so core needs no workerdeck dependency and a test can hand it a literal.
 */
export interface AgentSessionRecord {
  /** Layer-B ownership: `scope.user` is stamped by the worker from the creating principal. */
  scope?: Record<string, string>
  /** What the creator said about the session. Server-stamped on the browser path (`gateCreate`). */
  meta?: Record<string, unknown>
}

export type AgentSessionAccess =
  /** The caller's own session: see, attach, send into, approve for, interrupt, delete. */
  | { kind: 'owner' }
  /** A room's reader looking at that room's agent turn: the transcript, and nothing else. */
  | { kind: 'reader'; room: string }
  | { kind: 'none' }

/**
 * A registered widening rule. Returns a verdict, or null to abstain. It is only ever consulted for
 * a session the caller does NOT own, so a rule can never take ownership away and never needs to
 * re-check it. Must be synchronous: workerdeck's `canSee` is.
 */
export type AgentSessionRule = (user: string, session: AgentSessionRecord) => AgentSessionAccess | null

const rules = new Map<string, AgentSessionRule>()

/** Register a widening rule under a stable id (the feature's). Returns the unregister. */
export function registerAgentSessionRule(id: string, rule: AgentSessionRule): () => void {
  if (rules.has(id)) throw new Error(`agent session rule "${id}" registered twice`)
  rules.set(id, rule)
  return () => {
    if (rules.get(id) === rule) rules.delete(id)
  }
}

/**
 * What `user` may do with `session`.
 *
 * Owner first, and ownership is `scope` and nothing else (docs/SERVER.md the two layers). Then the
 * registered rules, first non-null verdict wins; a rule that throws is refused rather than trusted,
 * because the safe answer to "I cannot tell" is `none`. Everything else is `none`, which the
 * callers turn into the worker's 404 - existence is not confirmed either.
 *
 * `reader` is a verdict about READING. Turning it into "may attach to the session's socket" is the
 * caller's mistake to avoid: the attach socket is bidirectional (see session-relay.ts).
 */
export function agentSessionAccess(user: string, session: AgentSessionRecord): AgentSessionAccess {
  if (session.scope?.user === user) return { kind: 'owner' }
  for (const [id, rule] of rules) {
    let verdict: AgentSessionAccess | null
    try {
      verdict = rule(user, session)
    } catch (err) {
      console.error(`[agent] session rule "${id}" failed: ${String((err as Error)?.message ?? err)}`)
      continue
    }
    if (verdict && verdict.kind !== 'none') return verdict
  }
  return { kind: 'none' }
}
