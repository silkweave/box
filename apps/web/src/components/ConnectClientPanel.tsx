import * as React from 'react'
import brand from 'virtual:box-brand'
import { CopyField, FieldGrid, SettingsGroup, SettingsNotice } from '@silkweave/box-ui'
import { trpc } from '../lib/trpc.ts'

/** The server name a client lists this Box under: the brand as a lowercase slug. */
const serverName = (): string => (brand.name || 'box').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'box'

interface ClientPath {
  id: string
  label: string
  command: (url: string, name: string) => string
  after: string
}

// Tested end to end against MCP sign-in (spikes 2026-11-12): both find the sign-in from the URL alone.
const CLIENTS: readonly ClientPath[] = [
  { id: 'claude-code', label: 'Claude Code', command: (url, name) => `claude mcp add --transport http ${name} ${url}`, after: 'Then run /mcp in Claude Code and choose Authenticate.' },
  { id: 'codex', label: 'Codex', command: (url, name) => `codex mcp add ${name} --url ${url}`, after: 'Codex opens the sign-in in your browser.' },
]

/** Whether this Box offers MCP sign-in (`installed`) and the https address clients reach it at (`url`); null while loading. */
export function useConnectStatus(): { installed: boolean; url: string | null } | null {
  const [status, setStatus] = React.useState<{ installed: boolean; url: string | null } | null>(null)
  React.useEffect(() => {
    trpc.connectStatus.query({}).then(setStatus, () => setStatus(null))
  }, [])
  return status
}

/**
 * Connect a client: the MCP URL and a copy-ready command per client. The client finds the sign-in
 * from the URL, the person approves in this browser, and the app appears under Connected apps.
 * Hidden on a Box without MCP sign-in; where it is not offered (no https address) it says what is missing.
 */
export function ConnectClientPanel() {
  const status = useConnectStatus()
  if (!status?.installed) return null
  const url = status.url
  if (!url) {
    return (
      <SettingsNotice title='AI clients cannot sign in yet'>
        They can once this Box has an https address (or on this computer at localhost). An administrator sets it up.
      </SettingsNotice>
    )
  }
  const name = serverName()
  return (
    <SettingsGroup
      title='Connect an AI client'
      description='Add this Box to your AI client with its URL, then approve the connection here in your browser. The client must reach this address (on your tailnet, for example). Other clients (Cursor, VS Code, Gemini CLI, ...): add the MCP URL as a streamable HTTP server.'>
      <FieldGrid columns={1}>
        <CopyField label='MCP URL' value={url} />
        {CLIENTS.map((c) => <CopyField key={c.id} label={c.label} value={c.command(url, name)} hint={c.after} />)}
      </FieldGrid>
    </SettingsGroup>
  )
}
