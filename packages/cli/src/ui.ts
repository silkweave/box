// Small character-cell presentation primitives shared by repository CLI commands.
import { stripVTControlCharacters } from 'node:util'

export type Tone = 'text' | 'muted' | 'accent' | 'active' | 'good' | 'warn' | 'bad'
export interface Span { text: string; tone?: Tone }
export type Row = Span[]
export const span = (text: string, tone: Tone = 'text'): Span => ({ text, tone })
const palette: Record<Tone, string> = {
  text: '#e4e4ef', muted: '#8888a0', accent: '#7b7ef5', active: '#7b7ef5',
  good: '#86d9b0', warn: '#f3c778', bad: '#f58e9b',
}
const stops = ['#c5a3e8', '#a3a4e8', '#7b7ef5', '#8aaeea', '#a8e5ed']
const rgb = (hex: string): number[] => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16))
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Child output is data: never allow it to move the cursor or inject terminal commands. */
export function cleanText(text: string): string {
  // oxlint-disable-next-line no-control-regex -- Remove terminal controls from untrusted output.
  return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
}

function cellWidth(text: string): number {
  const point = text.codePointAt(0) ?? 0
  if (/^(?:\p{Mark}|\u200d|\ufe0f)+$/u.test(text)) return 0
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return 2
  return point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
    (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
    (point >= 0xac00 && point <= 0xd7a3) || (point >= 0xf900 && point <= 0xfaff) ||
    (point >= 0xfe10 && point <= 0xfe19) || (point >= 0xfe30 && point <= 0xfe6f) ||
    (point >= 0xff00 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6) ||
    (point >= 0x20000 && point <= 0x3fffd)) ? 2 : 1
}

export function widthOf(text: string): number {
  return Array.from(segments.segment(cleanText(text))).reduce((sum, item) => sum + cellWidth(item.segment), 0)
}

export function clip(text: string, width: number): string {
  const safe = cleanText(text)
  if (widthOf(safe) <= width) return safe
  let result = '', used = 0
  for (const { segment } of segments.segment(safe)) {
    const size = cellWidth(segment)
    if (used + size > width - 1) break
    result += segment
    used += size
  }
  return width > 0 ? result + '…' : ''
}

export function paint(text: string, tone: Tone, depth: number, tick: number): string {
  if (depth < 4) return text
  if (depth < 24) {
    const ansi: Record<Tone, number> = { text: 39, muted: 90, accent: 94, active: 94, good: 32, warn: 33, bad: 31 }
    return `\x1b[${ansi[tone]}m${text}\x1b[0m`
  }
  if (tone !== 'active') return `\x1b[38;2;${rgb(palette[tone]).join(';')}m${text}\x1b[0m`
  return Array.from(segments.segment(text)).map(({ segment }, index) => {
    const position = (Math.sin(index / 9 - tick / 800) + 1) * 2
    const a = Math.min(3, Math.floor(position)), mix = position - a
    const from = rgb(stops[a]), to = rgb(stops[a + 1])
    const color = from.map((value, i) => Math.round(value + (to[i] - value) * mix))
    return `\x1b[38;2;${color.join(';')}m${segment}`
  }).join('') + '\x1b[0m'
}

/** Erase every line tail as well as removed rows. Never write into the last screen column. */
export function screenFrame(rows: Row[], columns: number, height: number, depth: number, tick: number): string {
  const body = rows.slice(0, Math.max(1, height - 1)).map(row => {
    let available = Math.max(1, columns - 1)
    return row.map(part => {
      const text = clip(part.text, available)
      available -= widthOf(text)
      return paint(text, part.tone ?? 'text', depth, tick)
    }).join('') + '\x1b[K'
  }).join('\r\n')
  return `\x1b[H${body}\x1b[J`
}

export const elapsedText = (ms: number): string => ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`
