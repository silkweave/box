import { request, type OutgoingHttpHeaders } from 'node:http'

export function applicationUpgrade(url: string, headers: OutgoingHttpHeaders) {
  // Bun can stall an upgrade on a pooled connection previously used for HTTP.
  // A WebSocket owns its connection for its entire lifetime, so never pool it.
  return request(url, { headers, agent: false })
}
