// Each user's default agent profile (users.agent_profile), cached in-process so the synchronous
// engine rule in agent-profiles.ts can read it. users/state.ts is the only writer of that column and
// keeps this map in step: every readUsers() refreshes it and every upsert/delete updates it. The
// server warms it at boot (main.ts reads the directory before any agent start).
//
// A process that never read the directory (a one-off CLI command) sees no defaults and falls back to
// the deployment rule; every agent start happens in the server, which has always read it.

const defaults = new Map<string, string>()

/** Record a user's default profile; null or empty clears it. */
export function rememberAgentDefault(userId: string, profile: string | null): void {
  if (profile) defaults.set(userId, profile)
  else defaults.delete(userId)
}

export function forgetAgentDefault(userId: string): void {
  defaults.delete(userId)
}

/** The user's chosen default profile name, or null when none is set (or not yet read). */
export function agentDefaultProfile(userId: string): string | null {
  return defaults.get(userId) ?? null
}
