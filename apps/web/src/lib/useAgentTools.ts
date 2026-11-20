// Agent tools (Settings > Agent tools): the toolsets chat rooms and agent triggers grant to their
// sessions (core agent-tools.ts), and the servers a toolset can attach (the mcp recipe's,
// Settings > MCP Servers). Admin settings in box.local.json.

import { createDataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'

export interface AgentMcpServer {
  id: string
  label: string
}

export interface AgentToolset {
  id: string
  label: string
  description: string
  servers: string[]
  allow: string[]
  deny: string[]
  /** Built in: the only Box tools its sessions keep; null keeps them all. */
  boxTools: string[] | null
  /** Registered by a feature; not editable. */
  builtIn: boolean
}

export interface AgentToolsSettings {
  servers: AgentMcpServer[]
  /** Whether this Box has the mcp recipe (servers at all). */
  serversAvailable: boolean
  toolsets: AgentToolset[]
  problems: string[]
}

const store = createDataStore<AgentToolsSettings>(() => trpc.agentToolsList.query({}).then((d) => d as unknown as AgentToolsSettings))

export function useAgentTools(enabled = true): { data: AgentToolsSettings | null; error: string | null } {
  return store.useData(enabled)
}

async function apply(work: Promise<unknown>): Promise<void> {
  await work
  await store.reload()
}

export const saveAgentToolset = (input: Pick<AgentToolset, 'id' | 'servers' | 'allow' | 'deny'> & { label?: string; description?: string }) =>
  apply(trpc.agentToolsToolsetSave.mutate(input))
export const deleteAgentToolset = (id: string) => apply(trpc.agentToolsToolsetDelete.mutate({ id }))
