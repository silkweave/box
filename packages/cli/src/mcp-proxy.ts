// MCP CLI proxy - run the server's @Mcp() actions (IngestGithub, WarehouseBackup, RedditProbe, ...)
// from the terminal. Connects to the running server's Streamable-HTTP MCP transport and invokes
// tools, so an "action" defined once in the backend is callable over the dashboard (tRPC), agents
// (MCP), and here (CLI) - no per-action script needed.
//
//   bun run cli                                        # interactive: list + invoke tools
//   bun run cli run-now                                # invoke one tool
//   Configure mcp.url and mcp.token in box.local.json.
//
// Requires the server running: box dev

import { silkweave } from '@silkweave/core'
import { cliProxy, defaultFormatter, type CLIFormatterFn } from '@silkweave/mcp/cli-proxy'
import { readBoxConfig } from '@silkweave/box-core/box-json'

// This subpath imports only Node builtins, keeping the proxy independent of the warehouse.
const config = readBoxConfig(process.cwd())
const url = new URL(config.mcp.url ?? `http://localhost:${config.server.port}/mcp`)
const token = config.mcp.token

// Survive a restart window: a supervised Box respawns a few seconds after the automation feature's
// `service-restart` tool (or a crash), during which connections are refused. Retry
// connection-level failures only - HTTP-level errors pass straight through.
const retryingFetch: typeof fetch = async (input, init) => {
  let lastErr: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1_000))
    try {
      const res = await fetch(input, init)
      return typeof init?.body === 'string' && init.body.includes('"tools/list"') ? withPlainNullables(res) : res
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

// A nullable input (`nullable: true` on the DTO, e.g. a trigger's `cooldown_min`) is published as
// `anyOf: [{type}, {type: 'null'}]`. @silkweave/mcp 5.2.1's proxy builds an option per property from
// its `type` and throws on one without, which takes down every `box <tool>` command, not just that
// tool. Present such a property as its non-null branch: the option takes a value, and clearing it
// stays with the web UI and MCP clients, which send null.
type SchemaProp = { anyOf?: SchemaProp[]; type?: string; description?: string }
function plainNullables(message: { result?: { tools?: { inputSchema?: { properties?: Record<string, SchemaProp> } }[] } }) {
  for (const tool of message.result?.tools ?? []) {
    const props = tool.inputSchema?.properties ?? {}
    for (const [key, prop] of Object.entries(props)) {
      const branches = prop.anyOf?.filter((b) => b.type !== 'null')
      if (prop.type || !branches || branches.length !== 1) continue
      const { anyOf: _, ...rest } = prop
      props[key] = { ...branches[0], ...rest }
    }
  }
  return message
}
async function withPlainNullables(res: Response): Promise<Response> {
  if (!res.ok) return res
  const text = await res.text()
  const rewrite = (json: string) => {
    try {
      return JSON.stringify(plainNullables(JSON.parse(json)))
    } catch {
      return json
    }
  }
  const body = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.replace(/^data: (.*)$/gm, (_, json: string) => `data: ${rewrite(json)}`)
    : rewrite(text)
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}

// A refused tool call (validation, a write the record layer rejects) comes back as an error result
// whose text is `{"success":false,...}`. @silkweave/mcp 5.2.1's proxy prints it and still exits 0,
// so a script trusting the exit code logs the refusal as done. Fail the command instead.
const formatter: CLIFormatterFn = (message, index, messages) => {
  if (message.type === 'text' && /^\s*\{\s*"success"\s*:\s*false\b/.test(message.text)) process.exitCode = 1
  return defaultFormatter(message, index, messages)
}

await silkweave({ name: 'box', description: 'Silkweave Box actions over MCP', version: '0.1.0' })
  .adapter(cliProxy({ url, formatter, fetch: retryingFetch, ...(token && { headers: { authorization: `Bearer ${token}` } }) }))
  .start()
