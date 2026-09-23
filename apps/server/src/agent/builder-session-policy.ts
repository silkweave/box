export class BuilderSessionPolicyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** Workspace identity, working directory and session purpose are server-owned, not UI hints. */
export async function applyBuilderSessionPolicy(
  body: Record<string, unknown>,
  _principal: unknown,
  _engine: string,
  checkout: string,
): Promise<void> {
  const id = body.builderWorkspaceId
  delete body.builderWorkspaceId
  const meta = typeof body.meta === 'object' && body.meta !== null && !Array.isArray(body.meta)
    ? { ...body.meta as Record<string, unknown> }
    : {}
  delete meta.kind
  delete meta.builderWorkspaceId
  body.meta = meta
  // The ordinary assistant cannot select a Builder worktree by passing a custom cwd.
  body.cwd = checkout
  if (id === undefined) return
  throw new BuilderSessionPolicyError(410, 'builder_workspace_sessions_removed')
}
