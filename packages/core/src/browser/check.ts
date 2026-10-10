// Browser lease diagnostics: can this Box lease a tab from chromatrix, and what does it see?

import { CHROMATRIX_URL, connectCDP, DEFAULT_IDENTITY, detach, firstContext } from './cdp.js'

export interface CdpCheckResult {
  url: string
  contexts: number
  pages: { url: string; title: string }[]
  summary: string
}

/** Attach to the stealth browser, report the contexts/pages it can see, detach. Service-agnostic. */
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
      url: `${CHROMATRIX_URL()} (identity ${DEFAULT_IDENTITY()})`,
      contexts: browser.contexts().length,
      pages: out,
      summary: `leased a tab in chromatrix identity "${DEFAULT_IDENTITY()}" - ${browser.contexts().length} context(s), ${pages.length} page(s) in scope`,
    }
  } finally {
    await detach(browser)
  }
}

