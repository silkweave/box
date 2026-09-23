import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { BROWSER_PROTOCOL, browserPreviewPath, type BrowserControlState, type BrowserServerMessage } from '@silkweave/box-core/builder-browser'

/** Offers this visible Preview to the stable supervisor, independently of WorkerDeck. */
export function useBuilderBrowser(iframe: RefObject<HTMLIFrameElement | null>, enabled: boolean) {
  const [state, setState] = useState<BrowserControlState>()
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const socket = useRef<WebSocket | null>(null)
  const current = useRef<BrowserControlState | undefined>(undefined)
  const preview = useRef<{ generation: string; path: string } | null>(null)
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
        } else if (message.type === 'settled') {
          const active = current.current?.grant
          if (active?.nonce === message.nonce && active.tabId === current.current?.tabId && active.generation === message.generation) post({ ...message, type: 'box:browser-settled' })
        } else if (message.type === 'error') setError(message.message)
        else if (message.type === 'command') {
          const active = current.current?.grant
          if (!active || active.tabId !== current.current?.tabId || active.nonce !== message.grant.nonce || active.generation !== preview.current?.generation || message.deadline <= Date.now()) {
            send({ type: 'result', id: message.id, nonce: message.grant.nonce, generation: message.grant.generation, ok: false, error: 'The selected preview is no longer available' })
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
