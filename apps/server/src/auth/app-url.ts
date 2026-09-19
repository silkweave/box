// Where this Box lives, and how a sign-in link is spelled. ONE builder, because this string is a
// credential envelope and three copies of it drifted.
//
// It cannot live in core: the fallback needs `servicePort()`, which is the server's own notion of
// which port this process is actually serving on.
//
// ## Why the fallback tracks servicePort() and not DEFAULT_PORT
//
// An invite is a credential, and one built against a port this process is NOT serving on hands
// somebody a link into a DIFFERENT Box. Until 2026-09-14 the comment here said exactly that while
// the code used the default anyway, so every Box after the first invited people to :8190. Found by
// a throwaway boot on :8123 whose invite link pointed at :8190. See loopback-guard.ts.

import { boxJson } from '@silkweave/box-core'
import { servicePort } from '../agent/loopback-guard.js'

/** This Box's browser-facing origin, no trailing slash. `DASHBOARD_URL` in the environment wins,
 *  then `server.dashboardUrl` in box.json; otherwise localhost on the port this process
 *  actually serves. */
export function appUrl(): string {
  return (boxJson().server.dashboardUrl ?? `http://localhost:${servicePort()}`).replace(/\/+$/, '')
}

/**
 * The URL a person opens to sign in with a short-lived grant (core's auth/link.ts).
 *
 * Deliberately an SPA route carrying the grant in the QUERY, not a server `GET` that consumes it.
 * Link unfurlers (Lark, Slack) and URL detonators (SafeLinks, Defender) fetch a URL the moment it is
 * pasted; if the fetch consumed the grant, a single-use link would be burned before the human ever
 * clicked it, and they would be told it was "already used". A bot that fetches this URL gets
 * index.html and nothing happens - consumption takes a POST that only the click makes.
 */
export function signinLinkUrl(grant: string): string {
  return `${appUrl()}/login?link=${encodeURIComponent(grant)}`
}
