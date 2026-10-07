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
import { cliProxy } from '@silkweave/mcp/cli-proxy'
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
      return await fetch(input, init)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

await silkweave({ name: 'box', description: 'Silkweave Box actions over MCP', version: '0.1.0' })
  .adapter(cliProxy({ url, fetch: retryingFetch, ...(token && { headers: { authorization: `Bearer ${token}` } }) }))
  .start()
