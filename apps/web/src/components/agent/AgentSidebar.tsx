import * as React from 'react'
import {
  ChevronDown,
  Hammer,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Plus,
  Sparkles,
  SquareX,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { SessionPanel } from '@workerdeck/ui'
import { cn } from '@/lib/utils'
import {
  agentClient,
  agentProfileForEngine,
  agentProfileMissing,
  closeAgentSession,
  loadAgentConfig,
  refreshAgentSession,
  resolveAgentConflict,
  setAgentEngine,
  setAgentFullscreen,
  setAgentOpen,
  setAgentWidth,
  startAgentSession,
  useAgent,
} from '../../lib/agentStore.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { Button, confirm, Dialog, DialogContent, DialogDescription, DialogTitle, MenuRow, Popover, PopoverContent, PopoverTrigger } from '@silkweave/box-ui'

/**
 * The Assistant panel (docs/SERVER.md §3): a collapsible right-hand panel beside
 * AppShell's framed workspace hosting a live workerdeck session. All the transcript machinery
 * (streaming, tool cards, permission + question prompts, composer, interrupt) is
 * @workerdeck/ui's SessionPanel - the Box supplies only the slim header, the empty state, and the
 * one-agent-per-user takeover dialog. Always mounted (it owns the config fetch + re-attach flow);
 * renders md+ only - small screens keep the copy-paste flow.
 *
 * Two panel geometries, both persisted: a docked column whose width the separator drags (min
 * MIN_PANEL, always leaving MIN_MAIN for the view), and fullscreen - fixed over the workspace so
 * <main> keeps its scroll position underneath (AppShell marks it `inert`).
 */
export function AgentSidebar() {
  const { config, open, width, fullscreen, engine, sessionId, conflict, unavailable, starting, error } = useAgent()
  /** The profile the NEXT session starts under - which is the staged engine's, not the live one's. */
  const stagedProfile = agentProfileForEngine(config, engine)
  // Which Claude profile (config dir: settings, memory, skills, credentials) sessions run under.
  // Shown always when pinned - "as whom" is not a detail to leave implicit on a shared machine.
  const unmapped = agentProfileMissing(config)
  const asideRef = React.useRef<HTMLElement>(null)

  // Load policy once, re-attach on mount and whenever the window regains focus - a still-running
  // session (from before a reload, or started in another window) is picked up instead of an empty
  // panel. The worker registry, not client state, is the source of truth.
  React.useEffect(() => {
    void loadAgentConfig().then((c) => {
      if (c.enabled) void refreshAgentSession()
    })
    const onFocus = (): void => {
      void refreshAgentSession()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // A width dragged wide on a big screen must not squeeze the view when the window shrinks.
  React.useEffect(() => {
    if (fullscreen || width == null) return
    const clamp = (): void => {
      const row = asideRef.current?.parentElement
      if (!row) return
      const max = row.getBoundingClientRect().width - MIN_MAIN
      if (width > max) setAgentWidth(Math.max(MIN_PANEL, max))
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [fullscreen, width])

  // Closing the panel is a view preference. It must never interrupt or discard the live session.
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setAgentOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!config?.enabled) return null

  const endSession = async (): Promise<void> => {
    const ok = await confirm({
      title: 'End this agent session?',
      message: 'A running turn is interrupted and the session is closed. The transcript is discarded.',
      confirmLabel: 'End session',
      danger: true,
    })
    if (ok) await closeAgentSession()
  }

  return (
    <>
      {open && !fullscreen && <ResizeHandle />}
      {open && (
        <aside
          ref={asideRef}
          style={!fullscreen ? ({ '--agent-width': width != null ? `${width}px` : undefined } as React.CSSProperties) : undefined}
          className={cn(
            'fixed inset-0 z-50 flex min-h-0 w-full flex-col bg-bg shadow-(--shadow-lg) md:relative md:inset-auto md:z-auto md:shadow-none',
            // Fullscreen covers the workspace; docked, the ResizeHandle hairline is the panel's
            // left border and the frame stays visible beside it.
            fullscreen ? 'md:fixed md:inset-0 md:z-50 md:w-auto md:shadow-(--shadow-lg)' : 'md:w-[var(--agent-width,26rem)]',
          )}>
          <div className='flex h-14 shrink-0 items-center gap-2 border-b border-border px-3'>
            <Sparkles className='size-4 text-accent' />
            <span className='text-label font-medium tracking-wide text-fg-2 uppercase'>Assistant</span>
            {stagedProfile && (
              <span
                className='truncate rounded-sm bg-surface-hover px-1.5 py-0.5 text-label text-fg-3'
                title={`New sessions run under the “${stagedProfile}” profile`}>
                {stagedProfile}
              </span>
            )}
            {unavailable && (
              <span className='inline-flex items-center gap-1 text-label text-warning'>
                <WifiOff className='size-3' /> worker unreachable
              </span>
            )}
            <div className='min-w-0 flex-1' />
            <Button
              variant='ghost'
              size='icon-sm'
              title='New session'
              aria-label='New session'
              disabled={starting || unmapped}
              onClick={() => void startAgentSession()}>
              <Plus />
            </Button>
            {sessionId && (
              <Button
                variant='ghost'
                size='icon-sm'
                title='End session'
                aria-label='End session'
                onClick={() => void endSession()}>
                <SquareX />
              </Button>
            )}
            <Button
              variant='ghost'
              size='icon-sm'
              title={fullscreen ? 'Restore panel width' : 'Expand to full canvas'}
              aria-label={fullscreen ? 'Restore panel width' : 'Expand to full canvas'}
              aria-pressed={fullscreen}
              onClick={() => setAgentFullscreen(!fullscreen)}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              title='Hide agent panel'
              aria-label='Hide agent panel'
              onClick={() => setAgentOpen(false)}>
              <PanelRightClose />
            </Button>
          </div>

          {sessionId ? (
            // key: SessionPanel attaches per session - remount to switch.
            <SessionPanel key={sessionId} client={agentClient} sessionId={sessionId} className='min-h-0 flex-1' />
          ) : unmapped ? (
            // Refused before it starts: running this person on another teammate's config dir would
            // mean their Claude account, memory and skills - so say who to ask instead.
            <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
              <TriangleAlert className='size-6 text-warning' />
              <p className='max-w-64 text-body-sm text-muted-foreground'>
                No Assistant profile is mapped to{' '}
                <span className='text-text'>{config?.user?.display ?? 'your account'}</span>, so agent sessions
                can't start. Ask an admin to add you to <code className='text-code'>config/agent-profiles.json</code>.
              </p>
            </div>
          ) : (
            <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
              <Sparkles className='size-6 text-accent-dim' />
              <p className='max-w-64 text-body-sm text-muted-foreground'>
                No Assistant session. Start one here, or hit Run now on a Generate button.
              </p>
              {/* Only worth showing when there is a choice: one engine is not a decision. */}
              {(config?.engines.length ?? 0) > 1 && (
                <div
                  role='radiogroup'
                  aria-label='Agent engine'
                  className='inline-flex rounded-md border border-border p-0.5'>
                  {config?.engines.map((e) => {
                    const active = e.id === (engine ?? config.defaultEngine)
                    return (
                      <button
                        key={e.id}
                        type='button'
                        role='radio'
                        aria-checked={active}
                        title={`Run new sessions under “${e.profile}”`}
                        onClick={() => setAgentEngine(e.id)}
                        className={cn(
                          'rounded-sm px-2.5 py-1 text-label capitalize transition-colors',
                          active ? 'bg-surface-hover text-text' : 'text-fg-3 hover:text-text',
                        )}>
                        {e.id}
                      </button>
                    )
                  })}
                </div>
              )}
              {error && <p className='max-w-64 text-body-sm text-danger'>{error}</p>}
              <Button variant='secondary' size='sm' disabled={starting} onClick={() => void startAgentSession()}>
                New session
              </Button>
            </div>
          )}
        </aside>
      )}

      {/* One agent per user: creating while a live session exists surfaces the takeover choice. */}
      <Dialog open={conflict !== null} onOpenChange={(next) => !next && void resolveAgentConflict('cancel')}>
        <DialogContent>
          <DialogTitle>An agent run is active</DialogTitle>
          <DialogDescription className='leading-relaxed'>
            Only one interactive agent session runs per user
            {conflict?.session.title ? (
              <>
                {' '}
                - yours is currently <span className='text-text'>“{conflict.session.title}”</span>.
              </>
            ) : (
              '.'
            )}{' '}
            Open the running session, or interrupt it and start fresh
            {conflict?.command ? (
              <>
                {' '}
                with <code className='text-code'>{conflict.command}</code>
              </>
            ) : null}
            .
            {conflict?.command ? (
              <>
                {' '}
                Opening the running session will <span className='text-text'>not</span> send it -
                it goes to your clipboard instead, ready to paste into the composer.
              </>
            ) : null}
          </DialogDescription>
          <div className='flex justify-end gap-2'>
            <Button variant='ghost' size='sm' onClick={() => void resolveAgentConflict('cancel')}>
              Cancel
            </Button>
            <Button variant='destructive' size='sm' onClick={() => void resolveAgentConflict('takeover')}>
              Interrupt and start new
            </Button>
            <Button size='sm' onClick={() => void resolveAgentConflict('open')}>
              Open it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Leave this much of the canvas to the view being worked on, and this much to the panel. */
const MIN_MAIN = 360
const MIN_PANEL = 320

/**
 * The panel's left edge: a hairline that doubles as the drag separator (so the aside needs no border
 * of its own), with an invisible fat hit area either side. Double-click restores the default width.
 */
function ResizeHandle() {
  const ref = React.useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    // The canvas row (AppShell) is the geometry reference: the panel hugs its right edge.
    const row = ref.current?.parentElement
    if (!row) return
    const move = (ev: PointerEvent): void => {
      const rect = row.getBoundingClientRect()
      setAgentWidth(Math.max(MIN_PANEL, Math.min(rect.width - MIN_MAIN, rect.right - ev.clientX)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={ref}
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize agent panel'
      onPointerDown={onPointerDown}
      onDoubleClick={() => setAgentWidth(null)}
      title='Drag to resize · double-click to reset'
      className='relative z-10 hidden w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent/60 active:bg-accent md:block'>
      <span className='absolute inset-y-0 -right-1.5 -left-1.5' />
    </div>
  )
}

/**
 * Is the panel actually claiming the whole canvas right now? Same gate the panel itself renders
 * behind (a disabled session must never inert the view because of a stale preference).
 */
export function useAgentFullscreen(): boolean {
  const { config, open, fullscreen } = useAgent()
  return open && fullscreen && config?.enabled === true
}

/** Work opens Assistant; the adjacent dropdown exposes admin workspace actions: Build and the Recipe Gallery. */
export function AgentToggle() {
  const { config, open, sessionId, session } = useAgent()
  const { principal } = useAuth()
  const canBuild = principal?.role === 'admin'
  if (!config?.enabled && !canBuild) return null
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const pending = (session?.pendingPermissionCount ?? 0) > 0
  const openGallery = (): void => { setMenuOpen(false); void navigate({ to: '/recipes' }) }
  const openBuilder = (): void => {
    const preview = window.location.pathname + window.location.search + window.location.hash
    window.location.assign(`/builder?preview=${encodeURIComponent(preview)}`)
  }
  return (
    <div className='inline-flex shrink-0 items-center rounded-lg border border-border' role='group' aria-label='Work tools'>
      <Button
        variant='ghost'
        size='sm'
        className={cn('relative', canBuild && 'rounded-r-none')}
        disabled={!config?.enabled}
        title='Open Assistant'
        aria-label='Work: open Assistant'
        aria-expanded={open && config?.enabled === true}
        onClick={() => setAgentOpen(true)}>
        <Sparkles className={open ? 'text-accent' : undefined} />
        <span>Work</span>
        {sessionId && (
          <span className={`absolute top-1 right-1 size-1.5 rounded-full ${pending ? 'bg-warning' : 'bg-success'}`} />
        )}
      </Button>
      {canBuild && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger render={<Button variant='ghost' size='sm' className='rounded-l-none border-l border-border px-2' aria-label='More work options' />}>
            <ChevronDown className='size-3.5' />
          </PopoverTrigger>
          <PopoverContent align='end' className='w-44 p-1'>
            <MenuRow onClick={openBuilder}><Hammer className='size-4' /><span>Build</span></MenuRow>
            <MenuRow onClick={openGallery}><LayoutGrid className='size-4' /><span>Recipe Gallery</span></MenuRow>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
