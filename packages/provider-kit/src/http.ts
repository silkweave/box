// Minimal JSON/text fetch with retry + descriptive User-Agent. Moved here from @silkweave/box-core's http.ts
// (which now re-exports it) because fetching is the ONE capability every provider needs and the
// only reason a provider would otherwise reach for core.

// Callers may supply their application's User-Agent through request headers.
const USER_AGENT = 'silkweave-box/0.1 (+https://github.com/silkweave)'

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
      })
      if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
      return (await res.json()) as T
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(500 * 2 ** attempt) // 0.5s, 1s, 2s backoff
    }
  }
  throw lastErr
}

// Like fetchJson but returns the raw response body as text (RSS/XML, sitemaps, HTML).
// The explicit accept-anything header is load-bearing: Reddit's edge (varnish) deterministically
// 403s undici/fetch requests that rely on the implicit default, while the same request with the
// header set explicitly returns 200 (verified 8/8 interleaved trials, 2026-07-14). curl always
// sends it, which is why manual re-probes of the RSS feed kept "working".
export async function fetchText(url: string, init: RequestInit = {}, retries = 3): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...init.headers },
      })
      if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(500 * 2 ** attempt) // 0.5s, 1s, 2s backoff
    }
  }
  throw lastErr
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
