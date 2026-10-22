// Interactive questions for first-run commands. Every question can carry a short explanation:
// typing `?` shows it and asks again, and guided mode (`explain`) shows it before asking.
import { createInterface } from 'node:readline/promises'
import { paint, type Tone } from './ui.js'

const depth = (): number => process.env.NO_COLOR !== undefined ? 1 : (process.stdout.isTTY ? 24 : 1)
const color = (text: string, tone: Tone): string => paint(text, tone, depth(), 0)
const write = (text: string): void => { process.stdout.write(text) }

export interface PromptOptions {
  /** Show every explanation before its question, instead of only on `?`. */
  explain: boolean
}

export function explanation(help: string | undefined): void {
  if (!help) return
  for (const line of help.split('\n')) write(`  ${color(`│ ${line}`, 'muted')}\n`)
}

async function readLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await rl.question(question)).trim() } finally { rl.close() }
}

const helpHint = (help: string | undefined, options: PromptOptions): string =>
  help && !options.explain ? color(' (? explains)', 'muted') : ''

/** A free-text answer; Enter keeps `fallback`. */
export async function ask(question: string, fallback: string, options: PromptOptions, help?: string): Promise<string> {
  if (options.explain) explanation(help)
  for (;;) {
    const answer = await readLine(`  ${question}${helpHint(help, options)} ${color(`[${fallback}]`, 'muted')}: `)
    if (answer === '?') { explanation(help ?? 'No more to say here: press Enter to keep the suggestion.'); continue }
    return answer || fallback
  }
}

/** Yes or no; Enter keeps `fallback`. */
export async function confirm(question: string, fallback: boolean, options: PromptOptions, help?: string): Promise<boolean> {
  if (options.explain) explanation(help)
  for (;;) {
    const answer = (await readLine(`  ${question}${helpHint(help, options)} ${color(fallback ? '[Y/n]' : '[y/N]', 'muted')}: `)).toLowerCase()
    if (answer === '?') { explanation(help ?? 'Press Enter to keep the suggestion.'); continue }
    if (!answer) return fallback
    if (answer === 'y' || answer === 'yes') return true
    if (answer === 'n' || answer === 'no') return false
  }
}

/** Split terminal input into keys: an arrow is three characters (ESC [ A), everything else one. */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = []
  for (let at = 0; at < chunk.length;) {
    const arrow = chunk[at] === '\u001b' && (chunk[at + 1] === '[' || chunk[at + 1] === 'O') && at + 2 < chunk.length
    keys.push(chunk.slice(at, arrow ? at + 3 : at + 1))
    at += arrow ? 3 : 1
  }
  return keys
}

export interface Choice<T> {
  value: T
  label: string
  detail?: string
}

/**
 * One choice from a short list: arrow keys (or the number) and Enter. `?` shows the explanation.
 * Without a terminal it returns the default.
 */
export async function choose<T>(question: string, choices: Choice<T>[], initial: number, options: PromptOptions, help?: string): Promise<T> {
  const stdin = process.stdin
  if (!stdin.isTTY || !process.stdout.isTTY) return choices[initial]!.value
  if (options.explain) explanation(help)
  write(`  ${question}${helpHint(help, options)}\n`)
  let at = initial
  let drawn = 0
  const draw = (): void => {
    if (drawn) write(`\x1b[${drawn}A`)
    choices.forEach((choice, index) => {
      const active = index === at
      const marker = active ? color('❯', 'accent') : ' '
      const label = color(`${index + 1}. ${choice.label}`, active ? 'accent' : 'text')
      const detail = choice.detail ? color(`  ${choice.detail}`, 'muted') : ''
      write(`\x1b[2K    ${marker} ${label}${detail}\n`)
    })
    write(`\x1b[2K  ${color('↑/↓ to move, Enter to choose', 'muted')}\n`)
    drawn = choices.length + 1
  }
  draw()
  return await new Promise<T>((resolve, reject) => {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const done = (error?: Error): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      if (error) { reject(error); return }
      write(`\x1b[${drawn}A\x1b[J  ${color('✓', 'good')} ${color(choices[at]!.label, 'text')}\n`)
      resolve(choices[at]!.value)
    }
    // A chunk can hold several keys (fast typing, a paste, a remote terminal): handle each in turn.
    const onData = (chunk: string): void => {
      for (const key of splitKeys(chunk)) {
        if (key === '\u0003') return done(new Error('cancelled'))
        if (key === '\r' || key === '\n') return done()
        if (key === '\x1b[A' || key === '\x1bOA' || key === 'k') at = (at + choices.length - 1) % choices.length
        else if (key === '\x1b[B' || key === '\x1bOB' || key === 'j') at = (at + 1) % choices.length
        else if (/^[1-9]$/.test(key) && Number(key) <= choices.length) at = Number(key) - 1
        else if (key === '?') {
          write(`\x1b[${drawn}A\x1b[J`)
          explanation(help ?? 'Pick the one that fits. You can change it later.')
          drawn = 0
        } else continue
        draw()
      }
    }
    stdin.on('data', onData)
  })
}
