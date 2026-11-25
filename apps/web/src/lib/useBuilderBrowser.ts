import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { BROWSER_NOT_APP_PAGE, BROWSER_PROTOCOL, BROWSER_SHELL_PROTOCOL, browserPreviewPath, type BrowserControlState, type BrowserPreviewState, type BrowserServerMessage, type BrowserShellCommand } from '@silkweave/box-core/builder-browser'
import { previewNavigationPath, previewResetTarget, readPreviewFrame } from './builderPreview.ts'

const LOAD_WAIT_MS = 10_000
const READY_WAIT_MS = 4_000
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Offers this visible Preview to the stable supervisor, independently of WorkerDeck. The shell
 * holds the connection, so it survives the frame navigating away or failing, and runs `state`,
 * `navigate` and `reset` itself on any page. `lastAppRoute` reads the last Box app route the
 * Preview showed.
 */
export function useBuilderBrowser(iframe: RefObject<HTMLIFrameElement | null>, enabled: boolean, lastAppRoute: () => string) {
  const [state, setState] = useState<BrowserControlState>()
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const socket = useRef<WebSocket | null>(null)
  const current = useRef<BrowserControlState | undefined>(undefined)
  const preview = useRef<{ generation: string; path: string } | null>(null)
  const appRoute = useRef(lastAppRoute)
  appRoute.current = lastAppRoute
  const post = useCallback((message: unknown) => iframe.current?.contentWindow?.postMessage(message, location.origin), [iframe])
  const send = useCallback((message: unknown): void => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message)) }, [])
  const stop = useCallback((): void => {
    post({ type: 'box:browser-revoke' })
    if (current.current?.grant?.tabId === current.current?.tabId) send({ type: 'revoke' })
  }, [post, send])
  const reset = useCallback((): void => {
    post({ type: 'box:browser-revoke' })
    preview.current = null
    setReady(false)
    send({ type: 'unavailable' })
    post({ type: 'box:preview-probe' })
  }, [post, send])
  /** What the agent sees for `state`: read from the frame itself, so it works on any page. */
  const previewState = useCallback((): BrowserPreviewState => {
    const frame = readPreviewFrame(iframe.current)
    const domControl = frame.page === 'app' && preview.current !== null && preview.current.path === frame.path
    const last = appRoute.current()
    const problem = domControl ? null
      : frame.page === 'error' ? 'The Preview could not load this page: the browser shows an error page (the server may be restarting or down, or the address is wrong).'
      : frame.page === 'outside' ? (frame.path?.startsWith('/artifacts/') ? 'The Preview shows an artifact page, which is not part of the Box app.' : 'The Preview shows a page that is not part of the Box app, such as a server error page.')
      : frame.page === 'loading' ? 'The Preview has no page loaded yet.'
      : 'This Box app page is not under control: it is still loading, is a protected route (sign-in, settings), or the app failed to render.'
    return { page: frame.page, path: frame.path, title: frame.title, domControl, problem, lastAppRoute: last, resetTarget: previewResetTarget({ path: frame.path, usable: domControl }, last) }
  }, [iframe])
  /** Points the frame at `path`, then waits for it to load and, for an app page, to become controllable. */
  const openInFrame = useCallback(async (path: string, deadline: number): Promise<BrowserPreviewState> => {
    const frame = iframe.current
    if (!frame) throw new Error('The Preview frame is not mounted. Ask the owner to switch Builder to Preview.')
    const loadBy = Math.min(Date.now() + LOAD_WAIT_MS, deadline - 1000)
    const loaded = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { frame.removeEventListener('load', done); resolve(false) }, Math.max(0, loadBy - Date.now()))
      function done(): void { clearTimeout(timer); resolve(true) }
      frame.addEventListener('load', done, { once: true })
    })
    // Invalidate the old page without probing it, so it cannot report ready again before it unloads.
    post({ type: 'box:browser-revoke' })
    preview.current = null
    setReady(false)
    send({ type: 'unavailable' })
    frame.src = path
    const didLoad = await loaded
    const readyBy = Math.min(Date.now() + READY_WAIT_MS, deadline - 500)
    let state = previewState()
    while (didLoad && state.page === 'app' && !state.domControl && Date.now() < readyBy) {
      await sleep(100)
      state = previewState()
    }
    return { ...state, loaded: didLoad }
  }, [iframe, post, previewState, send])
  const runShell = useCallback(async (command: BrowserShellCommand, deadline: number): Promise<BrowserPreviewState> => {
    if (command.op === 'state') return previewState()
    if (command.op === 'reset') return openInFrame(previewState().resetTarget, deadline)
    const path = previewNavigationPath(command.path, browserPreviewPath)
    if (!path) throw new Error('Navigation path is unavailable: use a Box app or artifact path such as /recipes or /artifacts/<slug>/ (not sign-in, settings, builder or api paths).')
    return openInFrame(path, deadline)
  }, [openInFrame, previewState])
  const shell = useRef(runShell)
  shell.current = runShell
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let inFlight: { id: string; nonce: string; generation: string } | null = null
    const receive = (event: MessageEvent): void => {
      if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const message = event.data
      if (message.type === 'box:preview-ready' && message.protocol === BROWSER_PROTOCOL && typeof message.generation === 'string' && /^[a-f0-9-]{36}$/.test(message.generation)) {
        const path = browserPreviewPath(message.path)
        if (!path) { reset(); return }
        if (preview.current?.generation !== message.generation || preview.current?.path !== path) {
          post({ type: 'box:browser-revoke' })
          preview.current = { generation: message.generation, path }
          inFlight = null
          send({ type: 'ready', ...preview.current })
        }
        setReady(true)
      } else if (message.type === 'box:preview-unavailable') {
        preview.current = null
        setReady(false)
        inFlight = null
        send({ type: 'unavailable' })
      } else if (message.type === 'box:browser-stop') stop()
      else if (message.type === 'box:browser-result' && inFlight && message.id === inFlight.id && message.nonce === inFlight.nonce && message.generation === inFlight.generation) {
        send({ type: 'result', ...inFlight, ok: message.ok === true, ...(message.ok === true ? { result: message.result } : { error: typeof message.error === 'string' ? message.error : 'Preview operation failed' }) })
        inFlight = null
      }
    }
    const connect = (): void => {
      if (disposed) return
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/builder-browser`)
      socket.current = ws
      ws.onopen = () => {
        setConnected(true)
        setError(undefined)
        send({ type: 'shell', version: BROWSER_SHELL_PROTOCOL })
        if (preview.current) send({ type: 'ready', ...preview.current })
        post({ type: 'box:preview-probe' })
      }
      ws.onmessage = event => {
        let message: BrowserServerMessage
        try { message = JSON.parse(String(event.data)) as BrowserServerMessage } catch { return }
        if (message.type === 'state') {
          current.current = message.state
          setState(message.state)
          const active = message.state.grant
          if (active && active.tabId === message.state.tabId && active.generation === preview.current?.generation) post({ type: 'box:browser-grant', grant: active })
          else {
            inFlight = null
            post({ type: 'box:browser-revoke' })
          }
        } else if (message.type === 'shell-command') {
          const { id, command, deadline } = message
          void shell.current(command, deadline).then(
            result => send({ type: 'shell-result', id, ok: true, result }),
            cause => send({ type: 'shell-result', id, ok: false, error: cause instanceof Error ? cause.message : 'Preview operation failed' }),
          )
        } else if (message.type === 'error') setError(message.message)
        else if (message.type === 'command') {
          const active = current.current?.grant
          if (!active || active.tabId !== current.current?.tabId || active.nonce !== message.grant.nonce || active.generation !== preview.current?.generation || message.deadline <= Date.now()) {
            send({ type: 'result', id: message.id, nonce: message.grant.nonce, generation: message.grant.generation, ok: false, error: BROWSER_NOT_APP_PAGE })
            return
          }
          inFlight = { id: message.id, nonce: active.nonce, generation: active.generation }
          post({ type: 'box:browser-grant', grant: message.grant })
          post({ ...message, type: 'box:browser-command', protocol: BROWSER_PROTOCOL })
        }
      }
      ws.onclose = () => {
        if (disposed) return
        setConnected(false)
        current.current = undefined
        setState(undefined)
        inFlight = null
        post({ type: 'box:browser-revoke' })
        reconnect = setTimeout(connect, 2000)
      }
      ws.onerror = () => { setError('Preview connection unavailable') }
    }
    window.addEventListener('message', receive)
    const probe = setInterval(() => { if (!preview.current) post({ type: 'box:preview-probe' }) }, 1000)
    connect()
    return () => {
      disposed = true
      stop()
      socket.current?.close()
      socket.current = null
      current.current = undefined
      clearTimeout(reconnect)
      clearInterval(probe)
      window.removeEventListener('message', receive)
    }
  }, [enabled, iframe, post, reset, send, stop])
  return { state, connected, ready, error, stop, reset, active: !!state?.grant && state.grant.tabId === state.tabId }
}
