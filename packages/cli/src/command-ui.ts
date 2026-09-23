// Compact, consistent receipts for Box commands that do not need verify's full-screen task view.
import { spawn } from 'node:child_process'
import { paint, type Tone } from './ui.js'

const depth = (): number => process.env.NO_COLOR !== undefined ? 1 : (process.stdout.isTTY ? 24 : 1)
const color = (text: string, tone: Tone): string => paint(text, tone, depth(), 0)

export function commandHeader(command: string): void {
  process.stdout.write(`\n${color('  silkweave', 'accent')}${color(` / ${command}`, 'muted')}\n\n`)
}

export function commandLine(text: string, tone: Tone = 'text', indent = 2): void {
  process.stdout.write(`${' '.repeat(indent)}${color(text, tone)}\n`)
}

export function commandValue(value: string): void {
  commandLine(value, 'accent')
}

export function commandSuccess(text: string): void {
  commandLine(`✓ ${text}`, 'good')
}

export function commandWarning(text: string): void {
  commandLine(`! ${text}`, 'warn')
}

export function commandError(text: string): void {
  process.stderr.write(`${color(`  ✕ ${text}`, 'bad')}\n`)
}

export function commandNotice(text: string): void {
  process.stderr.write(`${color(`  ${text}`, 'muted')}\n`)
}

function openBrowser(url: string): void {
  const [program, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const child = spawn(program, args, { detached: true, stdio: 'ignore' })
  child.on('error', error => commandError(`Could not open the browser: ${error.message}`))
  child.unref()
}

/** Offer a short, non-blocking browser-open window. Piped/CI output never waits. */
export async function offerBrowserOpen(url: string, seconds = 5): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  const input = process.stdin
  const raw = input.isRaw
  input.setRawMode?.(true)
  input.resume()
  return await new Promise<boolean>((resolve) => {
    let remaining = seconds
    let done = false
    let timer: ReturnType<typeof setInterval> | undefined
    const draw = () => process.stdout.write(`\r\x1b[K  ${color(`Press ENTER to open in the browser (${remaining})`, 'muted')}`)
    const finish = (opened: boolean, code?: number) => {
      if (done) return
      done = true
      if (timer) clearInterval(timer)
      input.off('data', onData)
      input.setRawMode?.(raw)
      input.pause()
      process.stdout.write(`\r\x1b[K${opened ? `  ${color('Opening in your browser…', 'good')}\n` : '\n'}`)
      if (opened) openBrowser(url)
      if (code !== undefined) process.exitCode = code
      resolve(opened)
    }
    const onData = (data: Buffer | string) => {
      const value = data.toString()
      if (value.includes('\u0003')) finish(false, 130)
      else if (value.includes('\r') || value.includes('\n')) finish(true)
    }
    input.on('data', onData)
    draw()
    timer = setInterval(() => {
      remaining -= 1
      draw()
      if (remaining <= 0) finish(false)
    }, 1000)
  })
}
