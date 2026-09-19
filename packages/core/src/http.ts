// Box-configured HTTP helpers over the reusable provider implementation.
import { fetchJson as providerFetchJson, fetchText as providerFetchText } from '@silkweave/box-provider-kit'
import { boxJson } from './box-config.js'
export { sleep } from '@silkweave/box-provider-kit'

export const userAgent = (): string => boxJson().http.userAgent

function configured(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers)
  if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent())
  return { ...init, headers: Object.fromEntries(headers) }
}

export const fetchJson = <T = unknown>(url: string, init: RequestInit = {}, retries = 3): Promise<T> =>
  providerFetchJson<T>(url, configured(init), retries)

export const fetchText = (url: string, init: RequestInit = {}, retries = 3): Promise<string> =>
  providerFetchText(url, configured(init), retries)
