// Agent tools (Settings > Agent tools): the MCP servers and toolsets chat rooms and agent triggers
// grant to their sessions (core agent-tools.ts). Admin settings in box.local.json; tokens are
// hand-edited there and only reported as set or not.

import { createDataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'

export interface AgentMcpServer {
  id: string
  url: string
  type: 'http' | 'sse'
  label: string
  hasToken: boolean
}

export interface AgentToolset {
  id: string
  label: string
  description: string
  servers: string[]
  allow: string[]
  deny: string[]
}

export interface AgentToolsSettings {
  servers: AgentMcpServer[]
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

export const saveAgentMcpServer = (input: { id: string; url: string; type?: 'http' | 'sse'; label?: string }) =>
  apply(trpc.agentToolsServerSave.mutate(input))
export const deleteAgentMcpServer = (id: string) => apply(trpc.agentToolsServerDelete.mutate({ id }))
export const saveAgentToolset = (input: Omit<AgentToolset, 'label' | 'description'> & { label?: string; description?: string }) =>
  apply(trpc.agentToolsToolsetSave.mutate(input))
export const deleteAgentToolset = (id: string) => apply(trpc.agentToolsToolsetDelete.mutate({ id }))
