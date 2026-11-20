// A short, human label for the browser behind a request ("Chrome on macOS"), from its User-Agent.
// A hint for people telling their own sessions and connections apart (Connected apps), never an
// identity or a security decision: the header is whatever the caller sends.

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
]

/** "Chrome on macOS", "Safari on iOS", "Firefox", "macOS", or null when nothing is recognised. */
export function deviceHint(userAgent: string | null | undefined): string | null {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : ''
  if (!ua) return null
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system
}
