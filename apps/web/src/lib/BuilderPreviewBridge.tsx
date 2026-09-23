import { useEffect } from 'react'
import { BROWSER_PROTOCOL, browserPreviewPath, parseBrowserCommand, type BrowserGrant } from '@silkweave/box-core/builder-browser'
import { isBuilderPreview } from './builderPreview.ts'
import { createBrowserDomExecutor } from './builderBrowserDom.ts'

/** Lives inside the authenticated app. Only the containing Builder frame can bind control. */
export function BuilderPreviewBridge() {
  useEffect(() => {
    if (!isBuilderPreview()) return
    let generation = crypto.randomUUID()
    let grant: BrowserGrant | null = null
    let previousPath = ''
    let previousTitle = ''
    let running = false
    let execution: { id: string; nonce: string; deadline: number } | null = null
    let navigation: { id: string; nonce: string; generation: string; path: string; deadline: number } | null = null
    let disposed = false
    let cancelExecution: (() => void) | undefined
    const send = (message: unknown): void => window.parent.postMessage(message, location.origin)
    const revoke = (): void => { grant = null; navigation = null; executor.dispose(); cancelExecution?.() }
    const createExecutor = () => createBrowserDomExecutor({
      generation,
      isActive: () => !disposed && grant !== null && grant.generation === generation && grant.expiresAt > Date.now() && (!execution || (execution.nonce === grant.nonce && execution.deadline > Date.now())) && browserPreviewPath(location.pathname + location.search + location.hash) !== null,
      scheduleNavigation: path => { if (execution) navigation = { ...execution, generation, path } },
    })
    let executor = createExecutor()
    const notify = (force = false): void => {
      const path = location.pathname + location.search + location.hash
      if (path !== previousPath) {
        revoke()
        executor.dispose()
        generation = crypto.randomUUID()
        executor = createExecutor()
      }
      if (force || path !== previousPath || document.title !== previousTitle) {
        send({ type: 'box:preview-location', path, title: document.title })
        if (browserPreviewPath(path)) send({ type: 'box:preview-ready', protocol: BROWSER_PROTOCOL, generation, path })
        else send({ type: 'box:preview-unavailable' })
      }
      previousPath = path
      previousTitle = document.title
      if (grant && grant.expiresAt <= Date.now()) revoke()
    }
    const receive = async (event: MessageEvent): Promise<void> => {
      if (event.source !== window.parent || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return
      const message = event.data
      if (message.type === 'box:preview-probe') { notify(true); return }
      if (message.type === 'box:browser-revoke') { revoke(); return }
      if (message.type === 'box:browser-grant') {
        const next = message.grant as BrowserGrant | undefined
        if (next?.generation !== generation || typeof next.nonce !== 'string' || next.expiresAt <= Date.now() || !browserPreviewPath(location.pathname + location.search + location.hash)) return
        if (grant?.nonce !== next.nonce) { executor.dispose(); executor = createExecutor() }
        grant = next
        return
      }
      if (message.type === 'box:browser-settled') {
        const next = navigation
        if (!next || message.id !== next.id || message.nonce !== next.nonce || message.generation !== next.generation) return
        navigation = null
        if (message.ok && grant?.nonce === next.nonce && generation === next.generation && next.deadline > Date.now() && grant.expiresAt > Date.now() && browserPreviewPath(next.path)) location.assign(next.path)
        return
      }
      if (message.type !== 'box:browser-command' || message.protocol !== BROWSER_PROTOCOL) return
      notify()
      const current = grant
      if (!current || message.grant?.nonce !== current.nonce || message.grant?.generation !== generation || typeof message.id !== 'string') return
      const commandGeneration = generation
      const reply = (result: unknown, ok: boolean): void => send({ type: 'box:browser-result', id: message.id, nonce: current.nonce, generation: commandGeneration, ok, ...(ok ? { result } : { error: result }) })
      if (running || typeof message.deadline !== 'number' || message.deadline <= Date.now()) { reply('Preview command is busy or expired', false); return }
      running = true
      execution = { id: message.id, nonce: current.nonce, deadline: message.deadline }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const interrupted = new Promise<never>((_, reject) => {
          cancelExecution = () => reject(new Error('Preview control was revoked'))
          timer = setTimeout(() => { revoke(); send({ type: 'box:browser-stop' }) }, Math.max(1, message.deadline - Date.now()))
        })
        const result = await Promise.race([executor.execute(parseBrowserCommand(message.command)), interrupted])
        if (grant?.nonce !== current.nonce || disposed || message.deadline <= Date.now()) throw new Error('Preview control was revoked or expired')
        reply(result, true)
      } catch (error) { reply(error instanceof Error ? error.message : 'Preview operation failed', false) }
      finally { clearTimeout(timer); cancelExecution = undefined; running = false; execution = null }
    }
    const onMessage = (event: MessageEvent): void => { void receive(event) }
    const onStop = (): void => { revoke(); send({ type: 'box:browser-stop' }) }
    window.addEventListener('message', onMessage)
    window.addEventListener('box:browser-stop', onStop)
    const onNavigation = (): void => notify()
    window.addEventListener('popstate', onNavigation)
    window.addEventListener('hashchange', onNavigation)
    const timer = window.setInterval(notify, 200)
    notify(true)
    return () => {
      disposed = true
      revoke()
      executor.dispose()
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('box:browser-stop', onStop)
      window.removeEventListener('popstate', onNavigation)
      window.removeEventListener('hashchange', onNavigation)
      send({ type: 'box:preview-unavailable' })
    }
  }, [])
  return null
}
