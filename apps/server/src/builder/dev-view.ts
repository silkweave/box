import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cleanText, screenFrame, span, type Row, type Tone } from '../../../../packages/cli/src/ui.js'
import type { DiagnosticRecord } from '../diagnostics/runtime.js'
import type { SupervisedApplicationStatus } from './supervised-application.js'

export type DevLogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug'
type Entry = { at: Date; source: string; level: DevLogLevel; text: string }
type Actions = { restart: () => Promise<unknown>; restartFrontend: () => Promise<unknown>; quit: () => Promise<unknown> }
const levels: DevLogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug']
const rank = (level: DevLogLevel): number => levels.indexOf(level)
const tone = (level: DevLogLevel): Tone => level === 'error' ? 'bad' : level === 'warn' ? 'warn' : level === 'debug' ? 'muted' : 'text'

export function parseDevLogLevel(argv: string[]): DevLogLevel {
  if (argv.includes('--debug')) return 'debug'
  if (argv.includes('--verbose')) return 'verbose'
  const inline = argv.find(arg => arg.startsWith('--log-level='))?.slice('--log-level='.length)
  const at = argv.indexOf('--log-level')
  if (at >= 0 && !argv[at + 1]) throw new Error('--log-level needs a value')
  const value = inline ?? (at >= 0 ? argv[at + 1] : undefined) ?? 'info'
  if (!levels.includes(value as DevLogLevel)) throw new Error(`--log-level must be one of: ${levels.join(', ')}`)
  return value as DevLogLevel
}

function diagnosticLevel(record: DiagnosticRecord): DevLogLevel {
  if (/(error|failed|timeout|refused)/.test(record.event)) return 'error'
  if (/(unavailable|aborted|closed-before|signal)/.test(record.event)) return 'warn'
  if (/^(http|proxy|ws)\.|heartbeat/.test(record.event)) return 'debug'
  if (/^(operation|control)\.|readiness\.wait|child\./.test(record.event)) return 'verbose'
  return 'info'
}

function rawLevel(line: string, fallback: 'info' | 'warn'): DevLogLevel {
  if (/\b(error|fatal|exception|failed)\b/i.test(line)) return 'error'
  if (/\bwarn(?:ing)?\b/i.test(line) || fallback === 'warn') return 'warn'
  if (/\[Nest\].*\b(?:InstanceLoader|RoutesResolver|RouterExplorer)\b|\bdebug\b/i.test(line)) return 'verbose'
  return 'info'
}

/** Stateful terminal for box dev. All logs remain buffered when the current level hides them. */
export class DevView {
  readonly #out = process.stdout
  readonly #input = process.stdin
  readonly #live: boolean
  readonly #target: string
  readonly #url: string
  readonly #viteUrl: string
  readonly #status: () => SupervisedApplicationStatus
  #level: DevLogLevel
  #entries: Entry[] = []
  #scroll = 0
  #drawPending: ReturnType<typeof setImmediate> | undefined
  #actions: Actions | undefined
  #action = 'Starting…'
  #screen = false
  #raw = false
  #stopped = false

  constructor(options: { root: string; port: number; vitePort: number; level: DevLogLevel; status: () => SupervisedApplicationStatus }) {
    this.#target = basename(options.root)
    this.#url = `http://localhost:${options.port}`
    this.#viteUrl = `http://localhost:${options.vitePort}`
    this.#level = options.level
    this.#status = options.status
    this.#live = Boolean(this.#out.isTTY && this.#input.isTTY && !process.argv.includes('--plain') && process.env.TERM !== 'dumb')
  }

  start(): void {
    if (!this.#live) {
      this.#out.write(`silkweave / dev · ${this.#target} · log level ${this.#level}\n`)
      return
    }
    this.#out.write('\x1b[?1049h\x1b[?25l\x1b[2J')
    this.#screen = true
    this.#raw = this.#input.isRaw
    this.#input.setRawMode(true)
    this.#input.resume()
    this.#input.on('data', this.#onKey)
    process.stdout.on('resize', this.#onResize)
    this.draw()
  }

  setActions(actions: Actions): void { this.#actions = actions; this.#action = 'Ready'; this.draw() }

  diagnostic(record: DiagnosticRecord): void {
    const fields = Object.entries(record)
      .filter(([key]) => !['time', 'pid', 'component', 'event'].includes(key))
      .map(([key, value]) => `${key}=${String(value)}`).join(' ')
    this.add(record.component, diagnosticLevel(record), `${record.event}${fields ? ` · ${fields}` : ''}`)
  }

  child(source: 'app' | 'vite' | 'build', fallback: 'info' | 'warn', line: string): void {
    try {
      const record = JSON.parse(cleanText(line)) as DiagnosticRecord
      if (record && typeof record.event === 'string' && typeof record.component === 'string') { this.diagnostic(record); return }
    } catch { /* ordinary child output */ }
    this.add(source, rawLevel(line, fallback), line)
  }

  add(source: string, level: DevLogLevel, text: string): void {
    const entry = { at: new Date(), source, level, text: cleanText(text) }
    this.#entries.push(entry)
    if (this.#entries.length > 2_000) this.#entries.splice(0, this.#entries.length - 2_000)
    this.#scheduleDraw()
    if (!this.#live && rank(level) <= rank(this.#level)) {
      this.#out.write(`[${level}] ${source}: ${entry.text}\n`)
    }
  }

  async run(label: string, operation: (() => Promise<unknown>) | undefined): Promise<void> {
    if (!operation || this.#action.endsWith('…')) return
    this.#action = `${label}…`
    this.draw()
    try { await operation(); this.#action = 'Ready' }
    catch (error) { this.add('dev', 'error', error instanceof Error ? error.message : String(error)); this.#action = `${label} failed` }
    this.draw()
  }

  draw(): void {
    if (!this.#screen) return
    if (this.#drawPending) clearImmediate(this.#drawPending)
    this.#drawPending = undefined
    const height = this.#out.rows || 24
    const status = this.#status()
    const visible = this.#entries.filter(entry => rank(entry.level) <= rank(this.#level))
    const budget = Math.max(2, height - 10)
    const end = Math.max(0, visible.length - this.#scroll)
    const start = Math.max(0, end - budget)
    const rows: Row[] = [
      [span('  silkweave', 'accent'), span(' / dev')],
      [span(`  ${this.#target}`, 'muted')], [],
      [span(`  ${status.status === 'running' ? '✓' : status.status === 'failed' ? '✕' : '●'} `, status.status === 'running' ? 'good' : status.status === 'failed' ? 'bad' : 'active'), span(status.status.padEnd(10)), span(this.#url, 'accent'), span(`  HMR ${this.#viteUrl}`, 'muted')],
      [span(`  ${this.#action}`, this.#action.includes('failed') ? 'bad' : 'muted'), span(`  · log level ${this.#level}`, 'muted'), span(this.#scroll ? ` · ${this.#scroll} lines from latest` : '', 'warn')], [],
    ]
    for (const entry of visible.slice(start, end)) {
      rows.push([span(`  ${entry.at.toTimeString().slice(0, 8)} `, 'muted'), span(entry.source.padEnd(10).slice(0, 10), 'muted'), span(entry.text, tone(entry.level))])
    }
    while (rows.length < height - 2) rows.push([])
    rows.push([span('  ↑/↓ scroll   v verbosity   r restart app   f restart frontend   c clear   q quit', 'muted')])
    this.#out.write(screenFrame(rows, this.#out.columns || 80, height, this.#out.getColorDepth?.() ?? 1, performance.now()))
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    if (this.#drawPending) clearImmediate(this.#drawPending)
    this.#drawPending = undefined
    if (this.#screen) this.#out.write('\x1b[0m\x1b[?25h\x1b[?1049l')
    this.#screen = false
    if (this.#live) {
      this.#input.removeListener('data', this.#onKey)
      process.stdout.removeListener('resize', this.#onResize)
      this.#input.setRawMode(this.#raw)
      this.#input.pause()
    }
    this.#out.write(`\nsilkweave / dev · stopped · ${this.#url}\n`)
  }

  #onKey = (chunk: Buffer): void => {
    const key = chunk.toString()
    if (chunk.includes(3) || key === 'q') {
      if (!this.#actions) { this.stop(); process.exit(130) }
      void this.run('Stopping', this.#actions.quit)
      return
    }
    if (key === 'r') { void this.run('Restarting app', this.#actions?.restart); return }
    if (key === 'f') { void this.run('Restarting frontend', this.#actions?.restartFrontend); return }
    if (key === 'v') { this.#level = levels[(rank(this.#level) + 1) % levels.length]!; this.#scroll = 0 }
    else if (key === 'c') { this.#entries = []; this.#scroll = 0 }
    else if (key === '\x1b[A') this.#scroll = Math.min(this.#scroll + 1, this.#entries.length)
    else if (key === '\x1b[B') this.#scroll = Math.max(0, this.#scroll - 1)
    else if (key === '\x1b[5~') this.#scroll = Math.min(this.#scroll + 10, this.#entries.length)
    else if (key === '\x1b[6~') this.#scroll = Math.max(0, this.#scroll - 10)
    this.draw()
  }

  #scheduleDraw(): void {
    if (!this.#screen || this.#drawPending) return
    this.#drawPending = setImmediate(() => {
      this.#drawPending = undefined
      this.draw()
    })
  }

  #onResize = (): void => { this.#scheduleDraw() }
}
