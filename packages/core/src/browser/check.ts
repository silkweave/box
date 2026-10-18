// Browser lease diagnostics: can this Box open a Shuttle session, and what does it see?

import { BROWSER_URL, connectCDP, DEFAULT_IDENTITY, detach, firstContext } from './cdp.js'

export interface CdpCheckResult {
  url: string
  contexts: number
  pages: { url: string; title: string }[]
  summary: string
}

/** Open a session for the default agent, report the contexts/pages it can see, detach. Service-agnostic. */
export async function cdpCheck(): Promise<CdpCheckResult> {
  const browser = await connectCDP()
  try {
    const ctx = firstContext(browser)
    const pages = ctx.pages()
    const out: { url: string; title: string }[] = []
    for (const p of pages) {
      let title = ''
      try {
        title = await p.title()
      } catch {
        /* page may be mid-navigation */
      }
      out.push({ url: p.url(), title })
    }
    return {
      url: `${BROWSER_URL()} (agent ${DEFAULT_IDENTITY()})`,
      contexts: browser.contexts().length,
      pages: out,
      summary: `leased a Shuttle session for agent "${DEFAULT_IDENTITY()}" - ${pages.length} page(s) in scope`,
    }
  } finally {
    await detach(browser)
  }
}

