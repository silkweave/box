import { useState } from 'react'
import { Check, ClipboardCopy, Play, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { runAgent, useAgent } from '../../lib/agentStore.ts'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@silkweave/box-ui'

/**
 * The periwinkle "AI" button + explainer modal for the Claude Code skill commands the dashboard
 * hands off to (/illustration, /refine-content, /verify-content, /engage, /draft-reply,
 * /draft-content). Opening the modal copies the snippet to the clipboard immediately, so the
 * fallback flow is: click, read what it does, paste into a session.
 * When the agent sidebar is available (config/workerdeck.json declares a profile), the modal
 * also offers "Run now": start the command as a live session in the sidebar instead of pasting.
 *
 * The style is deliberately distinct from every other button: periwinkle (accent-dim) border
 * on a soft accent tint with a Sparkles mark - the app-wide measure for "this hands off to AI".
 */
export function GenerateButton({
  label,
  command,
  title,
  description,
  withDirection = false,
  className,
}: {
  /** Button text, e.g. "Generate Image". */
  label: string
  /** The exact snippet to copy. Keep a trailing space when the user must append input. */
  command: string
  /** Modal heading, e.g. "Generate an illustration". */
  title: string
  /** What exactly the command does, in a sentence or two. */
  description: React.ReactNode
  /** The command needs a free-form direction appended (e.g. /refine-content): Run now gains an
   *  inline input whose value is appended to the command. Copy behavior is unchanged. */
  withDirection?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [direction, setDirection] = useState('')
  const { config } = useAgent()
  const agentReady = config?.enabled ?? false

  const copy = (): void =>
    void navigator.clipboard.writeText(command).then(
      () => setCopied(true),
      () => setCopied(false),
    )

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) copy() // auto-copy the snippet the moment the modal opens
    else {
      setCopied(false)
      setDirection('')
    }
  }

  const runNow = (): void => {
    void runAgent(withDirection ? command + direction.trim() : command)
    onOpenChange(false)
  }

  return (
    <>
      <button
        type='button'
        onClick={() => onOpenChange(true)}
        title={`${title} - opens the command, copied ready to paste`}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-accent-dim/50 bg-accent-bg/60 px-2.5',
          'text-label font-medium text-accent transition-all select-none',
          'hover:border-accent-dim hover:bg-accent-bg hover:shadow-(--shadow-glow)',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          'active:translate-y-px',
          className,
        )}>
        <Sparkles className='size-3.5' />
        {label}
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle className='flex items-center gap-2'>
            <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-bg text-accent'>
              <Sparkles className='size-4' />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription className='leading-relaxed'>{description}</DialogDescription>

          <button
            type='button'
            onClick={copy}
            title='Copy again'
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
              copied ? 'border-accent-dim/50 bg-accent-bg/40' : 'border-border bg-code hover:border-accent-dim/40',
            )}>
            <code className='min-w-0 flex-1 break-all text-body-sm text-text'>{command}</code>
            {copied ? (
              <Check className='size-4 shrink-0 text-success' />
            ) : (
              <ClipboardCopy className='size-4 shrink-0 text-muted-foreground group-hover:text-text' />
            )}
          </button>

          <p className='text-label text-muted-foreground'>
            {copied ? 'Copied to your clipboard - ' : ''}paste it into a Claude Code session. It runs
            there, not here; the dashboard picks up the result live.
          </p>

          {agentReady && (
            <div className='flex items-center gap-2 border-t border-border pt-3'>
              {withDirection && (
                <input
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && direction.trim()) runNow()
                  }}
                  placeholder='Direction, e.g. tighten the intro'
                  className='h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 text-body-sm text-text placeholder:text-fg-4 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                />
              )}
              {!withDirection && (
                <p className='min-w-0 flex-1 text-label text-muted-foreground'>
                  Or run it right here, in the agent sidebar.
                </p>
              )}
              <Button size='sm' disabled={withDirection && !direction.trim()} onClick={runNow}>
                <Play className='size-3.5' />
                Run now
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
