import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http'
import { clientIp, requestIsSecure } from '@silkweave/box-core'

/** Preserve the public peer boundary before the app sees the supervisor as a loopback proxy. */
export function applicationHeaders(req: Pick<IncomingMessage, 'headers' | 'socket'>): OutgoingHttpHeaders {
  const headers = { ...req.headers }
  delete headers.forwarded
  delete headers['x-real-ip']
  // Only the supervisor decides which requests reach the Vite dev server.
  delete headers['x-box-frontend']
  headers['x-forwarded-for'] = clientIp(req)
  headers['x-forwarded-proto'] = requestIsSecure(req) ? 'https' : 'http'
  return headers
}

/** Permit only same-origin embedding of the live HTML preview; Builder itself remains unframed. */
export function previewResponseHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  if (!String(headers['content-type'] ?? '').includes('text/html')) return headers
  const next = { ...headers, 'x-frame-options': 'SAMEORIGIN' }
  const csp = headers['content-security-policy']
  if (typeof csp === 'string') next['content-security-policy'] = csp.replace(/frame-ancestors\s+[^;]+/g, "frame-ancestors 'self'")
  return next
}
