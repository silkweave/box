import { toPng } from 'html-to-image'

import type { BrowserCommand } from '@silkweave/box-core/builder-browser'
import { browserPreviewPath } from '@silkweave/box-core/builder-browser'

import { safePreviewPath } from './builderPreview'

const MAX_NODES = 500
const MAX_TEXT = 600
const MAX_TEXT_NODES = 200
const MAX_INPUT_VALUE = 1000
const MAX_SCREENSHOT_SIDE = 1600
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
const MAX_REFS = 2000

const SECRET_ATTRIBUTE = /(?:pass(?:word|wd)?|secret|token|api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|credential|bearer|jwt|session|cookie|ssn|social[\s_-]*security|oauth|mnemonic|seed|recovery|security[\s_-]*answer|(?:two|2|multi)[\s_-]*factor|\b(?:mfa|otp|pin)\b)/i
const PROTECTED_ROUTE = /^\/(?:account|auth|login|settings|control|admin)(?:\/|$)/i
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO'])

const STYLE_PROPERTIES: Record<string, string> = {
  color: 'color',
  background: 'background',
  'background-color': 'background-color',
  backgroundColor: 'background-color',
  borderColor: 'border-color',
  'border-color': 'border-color',
  outlineColor: 'outline-color',
  'outline-color': 'outline-color',
  fontSize: 'font-size',
  'font-size': 'font-size',
  fontFamily: 'font-family',
  'font-family': 'font-family',
  fontWeight: 'font-weight',
  'font-weight': 'font-weight',
  lineHeight: 'line-height',
  'line-height': 'line-height',
  letterSpacing: 'letter-spacing',
  'letter-spacing': 'letter-spacing',
  textAlign: 'text-align',
  'text-align': 'text-align',
  textDecoration: 'text-decoration',
  'text-decoration': 'text-decoration',
  borderRadius: 'border-radius',
  'border-radius': 'border-radius',
  borderWidth: 'border-width',
  'border-width': 'border-width',
  padding: 'padding',
  margin: 'margin',
  width: 'width',
  height: 'height',
  minWidth: 'min-width',
  'min-width': 'min-width',
  maxWidth: 'max-width',
  'max-width': 'max-width',
  minHeight: 'min-height',
  'min-height': 'min-height',
  maxHeight: 'max-height',
  'max-height': 'max-height',
  opacity: 'opacity',
  boxShadow: 'box-shadow',
  filter: 'filter',
}

const COMPUTED_PROPERTIES = [
  'display', 'visibility', 'position', 'width', 'height', 'overflow', 'opacity',
  'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
  'textAlign', 'padding', 'margin', 'borderRadius',
] as const

type RefEntry = { element: HTMLElement; ref: string; semanticKey: string }
type SnapshotNode = {
  ref: string
  tag: string
  role?: string
  name?: string
  text?: string
  disabled?: boolean
  checked?: boolean
  expanded?: boolean
  selected?: boolean
  required?: boolean
}
type Snapshot = {
  generation: string
  url: string
  title: string
  nodes: SnapshotNode[]
  truncated: boolean
  omitted: number
  limitations: string[]
}

export interface BrowserDomExecutorOptions {
  generation: string
  isActive: () => boolean
  scheduleNavigation?: (path: string) => void
}

export interface BrowserDomExecutor {
  execute(command: BrowserCommand): Promise<unknown>
  dispose(): void
}

function textValue(value: string | null | undefined, max = MAX_TEXT): string | undefined {
  if (!value) return undefined
  const result = value.replace(/\s+/g, ' ').trim().slice(0, max)
  return result || undefined
}

function hasSecretAttribute(element: Element): boolean {
  if (element.hasAttribute('data-builder-private')) return true
  if (element.tagName === 'LABEL' && SECRET_ATTRIBUTE.test(element.textContent ?? '')) return true
  const type = element.getAttribute('type')
  if (type && /^(?:password|hidden|file)$/i.test(type)) return true
  for (const name of ['aria-label', 'aria-labelledby', 'title', 'name', 'id', 'autocomplete']) {
    if (SECRET_ATTRIBUTE.test(element.getAttribute(name) ?? '')) return true
  }
  if (element instanceof HTMLInputElement && type && /^(?:password|hidden|file)$/i.test(type)) return true
  const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? element.labels
    : null
  return Boolean(labels && [...labels].some(label => SECRET_ATTRIBUTE.test(label.textContent ?? '')))
}

function isExcludedElement(element: Element): boolean {
  if (EXCLUDED_TAGS.has(element.tagName) || hasSecretAttribute(element)) return true
  if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden')) return true
  const style = getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

function isExcludedInTree(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (isExcludedElement(current)) return true
  }
  return false
}

function isProtectedRoute(pathname = window.location.pathname): boolean {
  return PROTECTED_ROUTE.test(pathname)
}

function assertPublicPage(): void {
  if (isProtectedRoute()) throw new Error('Browser DOM access is unavailable on a protected route')
  const current = browserPreviewPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
  if (!current || safePreviewPath(current) !== current) throw new Error('Browser DOM access is unavailable on this route')
}

function readableText(element: Element): string | undefined {
  if (isExcludedInTree(element)) return undefined
  const parts: string[] = []
  let length = 0
  let visited = 0
  const visit = (node: Node): void => {
    if (length >= MAX_TEXT || visited >= MAX_TEXT_NODES) return
    visited += 1
    if (node.nodeType === Node.TEXT_NODE) {
      const value = textValue(node.nodeValue)
      if (value) {
        const clipped = value.slice(0, MAX_TEXT - length)
        parts.push(clipped)
        length += clipped.length
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const child = node as Element
    if (child !== element && isExcludedElement(child)) return
    for (const descendant of child.childNodes) visit(descendant)
  }
  for (const child of element.childNodes) visit(child)
  return textValue(parts.join(' '))
}

function associatedLabel(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const label = element.labels?.[0]
    return textValue(label ? readableText(label) : undefined)
  }
  return undefined
}

function accessibleName(element: HTMLElement, text?: string): string | undefined {
  const aria = textValue(element.getAttribute('aria-label'))
  if (aria) return aria
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const value = textValue(labelledBy.split(/\s+/).map(id => document.getElementById(id)).map(node => node ? readableText(node) : '').filter(Boolean).join(' '))
    if (value) return value
  }
  const label = associatedLabel(element)
  if (label) return label
  return textValue(element.getAttribute('alt')) ?? textValue(element.getAttribute('title')) ?? text
}

function semanticKey(element: HTMLElement): string {
  return JSON.stringify({
    tag: element.tagName,
    type: element.getAttribute('type')?.toLowerCase() ?? '',
    role: element.getAttribute('role') ?? '',
    name: element.getAttribute('name') ?? '',
    id: element.id,
    ariaLabel: element.getAttribute('aria-label') ?? '',
    ariaLabelledBy: element.getAttribute('aria-labelledby') ?? '',
    contentEditable: element.isContentEditable,
    accessibleName: accessibleName(element, readableText(element)) ?? '',
  })
}

function isSnapshotCandidate(element: HTMLElement, text?: string): boolean {
  const style = getComputedStyle(element)
  const scrollable = (/(?:auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) ||
    (/(?:auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth)
  return Boolean(
    text || element.getAttribute('role') || element.getAttribute('aria-label') ||
    scrollable ||
    /^(?:A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION|H[1-6]|MAIN|NAV|FORM|DIALOG|TABLE|TR|TH|TD|LI|IMG)$/.test(element.tagName),
  )
}

function stateFor(element: HTMLElement): Pick<SnapshotNode, 'disabled' | 'checked' | 'expanded' | 'selected' | 'required'> {
  const result: Pick<SnapshotNode, 'disabled' | 'checked' | 'expanded' | 'selected' | 'required'> = {}
  if ('disabled' in element && Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)) result.disabled = true
  if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) result.checked = element.checked
  if (element.getAttribute('aria-expanded') !== null) result.expanded = element.getAttribute('aria-expanded') === 'true'
  if (element instanceof HTMLOptionElement) result.selected = element.selected
  if (element.hasAttribute('required')) result.required = true
  return result
}

function makeRef(element: HTMLElement, refs: Map<string, RefEntry>, refsByElement: WeakMap<HTMLElement, string>, refPrefix: string, next: () => number): string {
  const existing = refsByElement.get(element)
  if (existing && refs.get(existing)?.semanticKey === semanticKey(element)) return existing
  if (existing) refs.delete(existing)
  const ref = `dom-${refPrefix}-${next().toString(36)}`
  refsByElement.set(element, ref)
  refs.set(ref, { element, ref, semanticKey: semanticKey(element) })
  return ref
}

function rectFor(element: Element): { x: number; y: number; width: number; height: number } {
  const rect = element.getBoundingClientRect()
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
}

function inspectElement(element: HTMLElement, ref: string): Record<string, unknown> {
  const text = readableText(element)
  const computed = getComputedStyle(element)
  const styles: Record<string, string> = {}
  for (const property of COMPUTED_PROPERTIES) styles[property] = computed[property]
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? textValue(element.value, MAX_INPUT_VALUE)
    : undefined
  return {
    ref,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') ?? undefined,
    name: accessibleName(element, text),
    text,
    ...(value === undefined ? {} : { value }),
    rect: rectFor(element),
    styles,
    state: stateFor(element),
  }
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return Number.POSITIVE_INFINITY
  const payload = dataUrl.slice(comma + 1).replace(/\s/g, '')
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
}

function isCrossOriginMedia(element: Element): boolean {
  if (!(element instanceof HTMLImageElement || element instanceof HTMLSourceElement)) return false
  const sources = [element.getAttribute('src'), element.getAttribute('srcset'), element instanceof HTMLImageElement ? element.currentSrc : null]
    .filter((source): source is string => Boolean(source))
    .flatMap(source => source.includes(',') ? source.split(',').map(candidate => candidate.trim().split(/\s+/)[0]) : [source])
  for (const source of sources) {
    try {
      if (new URL(source, window.location.href).origin !== window.location.origin) return true
    } catch { return true }
  }
  return false
}

function hasCrossOriginCssImage(element: Element): boolean {
  const style = getComputedStyle(element)
  for (const property of ['background-image', 'list-style-image', 'border-image-source', 'mask-image', 'content']) {
    const value = style.getPropertyValue(property)
    const urls = value.match(/url\(\s*["']?([^"')]+)["']?\s*\)/gi) ?? []
    for (const token of urls) {
      const source = token.replace(/^url\(\s*["']?|["']?\s*\)$/gi, '')
      try {
        if (new URL(source, window.location.href).origin !== window.location.origin) return true
      } catch { return true }
    }
  }
  return false
}

function screenshotFilter(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return true
  const element = node as HTMLElement
  if (isExcludedInTree(element) || isCrossOriginMedia(element) || hasCrossOriginCssImage(element)) return false
  return !(element instanceof HTMLImageElement && element.crossOrigin && element.crossOrigin !== '')
}

function isDisabledControl(element: HTMLElement): boolean {
  return ('disabled' in element && Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLOptionElement).disabled)) ||
    Boolean(element.closest('fieldset[disabled]'))
}

function assertEditable(element: HTMLElement): asserts element is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (isExcludedInTree(element)) throw new Error('Element is unavailable for editing')
  if (element instanceof HTMLInputElement) {
    if (!/^(?:text|search|email|url|tel|number)$/i.test(element.type)) throw new Error('Only ordinary text inputs can be edited')
    if (element.readOnly || isDisabledControl(element)) throw new Error('Input is read-only')
    return
  }
  if (element instanceof HTMLTextAreaElement) {
    if (element.readOnly || isDisabledControl(element)) throw new Error('Input is read-only')
    return
  }
  if (element.isContentEditable) return
  throw new Error('Element is not an editable text control')
}

function assertClickSafe(element: HTMLElement): void {
  if (isExcludedInTree(element)) throw new Error('Element is unavailable for clicking')
  const control = element.closest('button, input, select, textarea, option')
  if (control && isDisabledControl(control as HTMLElement)) {
    throw new Error('Element is disabled')
  }
  const anchor = element.closest('a')
  if (anchor) {
    const target = anchor.getAttribute('target')
    if (target && target !== '_self') throw new Error('New-tab links are unavailable')
    if (anchor.hasAttribute('download')) throw new Error('Downloads are unavailable')
    const href = anchor.getAttribute('href')
    if (href) {
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin) throw new Error('External links are unavailable')
      if (!browserPreviewPath(`${url.pathname}${url.search}${url.hash}`)) throw new Error('This link is unavailable')
    }
  }
  const submitControl = control && ((control instanceof HTMLButtonElement && control.type === 'submit') || (control instanceof HTMLInputElement && /^(?:submit|image)$/i.test(control.type)))
  if (control?.closest('form') && submitControl) {
    throw new Error('Form submission is unavailable')
  }
}

function assertSafeStyle(name: string, value: string): string {
  const cssName = STYLE_PROPERTIES[name]
  if (!cssName) throw new Error(`Style property is not allowed: ${name}`)
  // CSS control characters and escapes are deliberately rejected.
  // oxlint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f<>;]|\/\*|\*\/|url\s*\(|expression\s*\(|var\s*\(|attr\s*\(|@import|!important/i.test(value)) throw new Error('Unsafe style value')
  if (value && typeof CSS !== 'undefined' && !CSS.supports(cssName, value)) throw new Error('Unsupported style value')
  return cssName
}

export function createBrowserDomExecutor({ generation, isActive, scheduleNavigation }: BrowserDomExecutorOptions): BrowserDomExecutor {
  const refs = new Map<string, RefEntry>()
  const refsByElement = new WeakMap<HTMLElement, string>()
  const refPrefix = (() => {
    try { return crypto.randomUUID().replaceAll('-', '').slice(0, 12) } catch { return Math.random().toString(36).slice(2, 14) }
  })()
  let counter = 0
  let disposed = false

  const assertActive = (): void => {
    if (disposed || !isActive()) throw new Error('Browser control has been revoked')
  }

  const pruneRefs = (): void => {
    for (const [ref, entry] of refs) {
      if (!entry.element.isConnected || entry.element.ownerDocument !== document) refs.delete(ref)
    }
    while (refs.size > MAX_REFS) {
      const oldest = refs.keys().next().value
      if (oldest === undefined) break
      refs.delete(oldest)
    }
  }

  const resolveRef = (ref: string): HTMLElement => {
    assertActive()
    const entry = refs.get(ref)
    if (!entry || !entry.element.isConnected || entry.element.ownerDocument !== document) throw new Error('Element reference is stale')
    if (isExcludedInTree(entry.element)) throw new Error('Element is unavailable')
    if (entry.semanticKey !== semanticKey(entry.element)) throw new Error('Element reference is stale')
    return entry.element
  }

  const snapshotNow = (): Snapshot => {
    assertActive()
    assertPublicPage()
    pruneRefs()
    const nodes: SnapshotNode[] = []
    let visited = 0
    let omitted = 0
    const walk = (node: Element): void => {
      if (visited >= MAX_NODES) { omitted += 1; return }
      visited += 1
      if (!(node instanceof HTMLElement) || isExcludedElement(node)) return
      const text = readableText(node)
      if (isSnapshotCandidate(node, text)) {
        const state = stateFor(node)
        nodes.push({
          ref: makeRef(node, refs, refsByElement, refPrefix, () => ++counter),
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute('role') ?? undefined,
          name: accessibleName(node, text),
          text,
          ...state,
        })
      }
      for (const child of node.children) walk(child)
    }
    walk(document.body ?? document.documentElement)
    return {
      generation,
      url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      title: textValue(document.title) ?? '',
      nodes,
      truncated: visited >= MAX_NODES,
      omitted,
      limitations: ['DOM snapshot is bounded to 500 visited nodes.', 'Sensitive controls and marked private content are omitted; secret detection is heuristic and not universal.'],
    }
  }

  const mutation = async <T>(op: string, action: () => T): Promise<Record<string, unknown>> => {
    assertActive()
    const before = snapshotNow()
    assertActive()
    const result = action()
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 100)
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { clearTimeout(timer); resolve() })
    })
    assertActive()
    const after = snapshotNow()
    assertActive()
    return { op, result, before, after }
  }

  const navigate = (path: string): { scheduled: true; path: string } => {
    assertActive()
    const corePath = browserPreviewPath(path)
    const safePath = corePath ? safePreviewPath(corePath) : '/'
    if (!corePath || safePath !== corePath || isProtectedRoute(new URL(corePath, window.location.origin).pathname)) throw new Error('Navigation path is unavailable')
    if (scheduleNavigation) {
      assertActive()
      scheduleNavigation(safePath)
    } else {
      setTimeout(() => {
        if (disposed || !isActive()) return
        window.location.assign(safePath)
      }, 0)
    }
    return { scheduled: true, path: safePath }
  }

  const screenshot = async (ref?: string): Promise<Record<string, unknown>> => {
    assertActive()
    assertPublicPage()
    const target = ref ? resolveRef(ref) : document.documentElement
    if (isExcludedInTree(target) || hasCrossOriginCssImage(target) || isCrossOriginMedia(target)) throw new Error('Screenshot target contains unavailable media')
    const isViewport = !ref
    const rect = isViewport
      ? { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) }
      : { width: Math.max(1, Math.round(target.getBoundingClientRect().width)), height: Math.max(1, Math.round(target.getBoundingClientRect().height)) }
    const width = Math.min(MAX_SCREENSHOT_SIDE, rect.width)
    const height = Math.min(MAX_SCREENSHOT_SIDE, rect.height)
    const dataUrl = await toPng(target, {
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      pixelRatio: 1,
      cacheBust: false,
      skipFonts: true,
      filter: screenshotFilter,
    })
    assertActive()
    if (dataUrlBytes(dataUrl) > MAX_SCREENSHOT_BYTES) throw new Error('Screenshot exceeds the 4 MB limit')
    return {
      image: {
        dataUrl,
        capture: 'dom',
        width,
        height,
        limitations: [
          'DOM capture is bounded to 1600 pixels per side and 4 MB.',
          'Scripts, frames, canvas/video/audio, marked private nodes, secret-like controls, and cross-origin media are omitted.',
          'Secret detection is heuristic and cannot guarantee that every secret-like value is excluded.',
        ],
      },
    }
  }

  const execute = async (command: BrowserCommand): Promise<unknown> => {
    assertActive()
    assertPublicPage()
    switch (command.op) {
      case 'snapshot': return snapshotNow()
      case 'inspect': {
        const element = resolveRef(command.ref)
        return inspectElement(element, command.ref)
      }
      case 'click': {
        const element = resolveRef(command.ref)
        assertClickSafe(element)
        return mutation('click', () => { element.click(); return { ref: command.ref } })
      }
      case 'type': {
        const element = resolveRef(command.ref)
        assertEditable(element)
        return mutation('type', () => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
            if (!setter) throw new Error('Text input is unavailable')
            setter.call(element, command.append ? element.value + command.text : command.text)
          } else {
            element.textContent = command.append ? (element.textContent ?? '') + command.text : command.text
          }
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
          element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
          return { ref: command.ref }
        })
      }
      case 'select': {
        const element = resolveRef(command.ref)
        if (!(element instanceof HTMLSelectElement) || isExcludedElement(element) || isDisabledControl(element)) throw new Error('Element is not an available select control')
        if (![...element.options].some(option => option.value === command.value)) throw new Error('Select option is unavailable')
        return mutation('select', () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
          if (!setter) throw new Error('Select control is unavailable')
          setter.call(element, command.value)
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
          element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
          return { ref: command.ref }
        })
      }
      case 'scroll': {
        const element = command.ref ? resolveRef(command.ref) : undefined
        return mutation('scroll', () => {
          if (element) element.scrollBy({ left: command.x, top: command.y, behavior: 'instant' })
          else window.scrollBy({ left: command.x, top: command.y, behavior: 'instant' })
          return { ref: command.ref, x: command.x, y: command.y }
        })
      }
      case 'navigate': return navigate(command.path)
      case 'style': {
        const element = resolveRef(command.ref)
        const styles = command.styles ?? {}
        const properties = Object.entries(styles).map(([name, value]) => [assertSafeStyle(name, value), value] as const)
        return mutation('style', () => {
          for (const [name, value] of properties) element.style.setProperty(name, value)
          return { ref: command.ref, styles: Object.fromEntries(properties) }
        })
      }
      case 'screenshot': return screenshot(command.ref)
      default: {
        const neverCommand: never = command
        throw new Error(`Unsupported browser operation: ${String(neverCommand)}`)
      }
    }
  }

  return {
    execute,
    dispose: () => {
      disposed = true
      refs.clear()
    },
  }
}
