// The policy gate (PERMISSIONS 9.2): while a policy change that writes files (agent config,
// toolsets) is being applied, new agent-session calls wait, so no session call runs against the
// database half of a change whose files are not written yet. In this process only; another
// process holds its own sessions and re-reads the files at the change's final revision.
//
// A change whose files could neither be written nor restored leaves the gate held: its journal
// entry stays unresolved, session calls and new sessions are refused, until the journal is
// reconciled (recoverPolicyJournal, at the next boot).

let gate: Promise<void> | null = null
let held: string | null = null

/** Keep the gate closed past the change that closed it: policy files are in an unknown state. */
export function holdPolicyGate(reason: string): void {
  held = reason
}

/** The journal was reconciled: the gate follows changes again. */
export function releasePolicyGateHold(): void {
  held = null
}

/** Why the gate is held, or null. */
export function policyGateHold(): string | null {
  return held
}

/** How long a session call waits for the gate before it is refused. */
export const POLICY_GATE_WAIT_MS = 30_000

/** Run `fn` with the gate closed; changes queue behind each other. */
export async function withPolicyGate<T>(fn: () => Promise<T>): Promise<T> {
  while (gate) await gate
  if (held) throw new Error(`refused: ${held}`)
  let open!: () => void
  gate = new Promise<void>((resolve) => (open = resolve))
  try {
    return await fn()
  } finally {
    gate = null
    open()
  }
}

/** Wait while the gate is closed; false when it stayed closed for `waitMs` (the call is refused). */
export async function passPolicyGate(waitMs = POLICY_GATE_WAIT_MS): Promise<boolean> {
  if (held) return false
  if (!gate) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), waitMs)))
  try {
    while (gate) {
      if ((await Promise.race([gate, timedOut])) === 'timeout') return false
    }
    return !held
  } finally {
    clearTimeout(timer)
  }
}

/** Whether a file-backed policy change is being applied in this process (tests, diagnostics). */
export function policyGateClosed(): boolean {
  return gate !== null || held !== null
}
