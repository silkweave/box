// Formula signals: a signal whose points are COMPUTED from other signals by an expression stored in
// `signals.formula` (`churn-rate = churned-mrr / start(mrr) * 100`). This module is pure: the
// language (tokenizer, recursive-descent parser, AST), the per-bucket evaluation, and the history
// resolver every read path goes through. Nothing here touches the warehouse; points.ts and the
// signals controller hand it the stored rows.
//
// THE LANGUAGE
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | primary
//   primary := number | '(' expr ')' | ('start' | 'prev') '(' ref ')' | ref
//   ref     := bare-id | '"' any-id '"'
//
//   • Numbers are decimal: `100`, `2.5`, `.5`.
//   • A bare id is a run of [a-z0-9_.@-] starting with a letter (`mrr`, `churned-mrr`,
//     `atomicbi.first_response`, `github@acme.followers`). Because `-` is a legal id character,
//     `a-b` is ONE id: write binary minus with spaces (`a - b`). A trailing `-` or `.` is never
//     part of a bare id, so `a- b` still reads as `a - b`. Ids a bare token cannot spell (a leading
//     digit, a `/` as in `npm.pkg.@acme/core`) are written quoted: `"npm.pkg.@acme/core"`.
//   • `x` (bare)   - x aggregated into the formula signal's own interval bucket: the SUM of x's
//                    buckets that start inside it for an `increment` input, the LAST value for a
//                    `snapshot` input. A bucket belongs to the window containing its start, with no
//                    proration (series.ts), so a weekly bucket straddling a month counts wholly in
//                    the month it starts in, and a coarser input contributes only to the formula
//                    bucket its own bucket starts in.
//   • `start(x)`   - the level entering the bucket: x's latest bucket that ENDED on or before the
//                    formula bucket's start (levelEntering's rule, at any grain).
//   • `prev(x)`    - bare x in the previous formula bucket.
//
// EVALUATION. A formula signal's history is computed over the union of its inputs' buckets (each
// floored to the formula's interval). Any operand that is missing (no data for that bucket, an
// unknown or cyclic input) makes the bucket produce NO point, as do division by zero and any
// non-finite result: an honest gap, never a fabricated 0. Formula inputs may themselves be formula
// signals; resolution is recursive and memoized, and a cycle (which the write path refuses through
// depends_on) resolves to an empty history rather than recursing.
//
// OVERRIDES. A manual point on a formula signal WINS its bucket over the computed value - the one
// deliberate inversion of the merge's live-beats-manual rule. A live feed is an external truth a
// hand entry should not mask; a computed value has no external truth of its own, it is arithmetic
// over other numbers, and the person who typed a correction knows something the inputs do not.
// Deleting the manual point brings the computed value back. Computed points carry `source: 'live'`
// with `computed: true`; an overriding manual point carries the value it hides as
// `shadowed_computed`. Stored live rows for a formula signal are ignored (nothing should write
// them: a formula signal cannot be connected, and occurrence counting is refused).

import { floorSignalBucket, mergeSignalPoints, nextSignalBucket, type MergedSignalPoint, type StorePoint } from './points.js'
import type { SignalAccumulation, SignalDefinition, SignalInterval } from './types.js'

// --- AST ------------------------------------------------------------------------------------------

export type FormulaFn = 'start' | 'prev'
export const FORMULA_FNS: readonly FormulaFn[] = ['start', 'prev']

export type FormulaNode =
  | { type: 'num'; value: number }
  | { type: 'ref'; id: string; pos: number }
  | { type: 'fn'; fn: FormulaFn; arg: { type: 'ref'; id: string; pos: number }; pos: number }
  | { type: 'neg'; arg: FormulaNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }

/** A parse failure, with the 0-based character position it was found at. */
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`formula: ${message} at position ${pos}`)
    this.name = 'FormulaError'
  }
}

// --- tokenizer ------------------------------------------------------------------------------------

type Token =
  | { kind: 'num'; value: number; start: number; end: number }
  | { kind: 'id'; id: string; quoted: boolean; start: number; end: number }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '(' | ')'; start: number; end: number }

const ID_START = /[a-z]/
const ID_CHAR = /[a-z0-9_.@-]/
const DIGIT = /[0-9]/
/** What a bare (unquoted) id can spell - anything else is written quoted. */
const BARE_ID = /^[a-z][a-z0-9_.@-]*$/

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if ('+-*/()'.includes(c)) {
      out.push({ kind: 'op', op: c as '+', start: i, end: i + 1 })
      i++
      continue
    }
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1] ?? ''))) {
      const start = i
      while (i < src.length && DIGIT.test(src[i])) i++
      if (src[i] === '.') {
        i++
        while (i < src.length && DIGIT.test(src[i])) i++
      }
      if (i < src.length && (ID_CHAR.test(src[i]) || src[i] === '"')) {
        throw new FormulaError(`a number cannot run into "${src[i]}" (an id must start with a letter, or be quoted)`, i)
      }
      out.push({ kind: 'num', value: Number(src.slice(start, i)), start, end: i })
      continue
    }
    if (ID_START.test(c)) {
      const start = i
      while (i < src.length && ID_CHAR.test(src[i])) i++
      // A trailing '-' or '.' belongs to the operator / punctuation side, never to the id.
      while (i > start + 1 && (src[i - 1] === '-' || src[i - 1] === '.')) i--
      out.push({ kind: 'id', id: src.slice(start, i), quoted: false, start, end: i })
      continue
    }
    if (c === '"') {
      const start = i
      const close = src.indexOf('"', i + 1)
      if (close < 0) throw new FormulaError('unterminated quoted id', start)
      const id = src.slice(i + 1, close)
      if (!id) throw new FormulaError('empty quoted id', start)
      out.push({ kind: 'id', id, quoted: true, start, end: close + 1 })
      i = close + 1
      continue
    }
    if (/[A-Z]/.test(c)) throw new FormulaError(`signal ids are lowercase, found "${c}"`, i)
    throw new FormulaError(`unexpected character "${c}"`, i)
  }
  return out
}

// --- parser ---------------------------------------------------------------------------------------

/** Parse a formula to its AST. Throws FormulaError (with the position) on any syntax error. */
export function parseFormula(src: string): FormulaNode {
  const tokens = tokenize(src)
  let k = 0
  const peek = (): Token | undefined => tokens[k]
  const posOf = (t: Token | undefined): number => (t ? t.start : src.length)
  const isOp = (t: Token | undefined, op: string): boolean => t?.kind === 'op' && t.op === op
  const describe = (t: Token | undefined): string =>
    !t ? 'end of formula' : t.kind === 'num' ? `number ${t.value}` : t.kind === 'id' ? `"${t.id}"` : `"${t.op}"`

  if (tokens.length === 0) throw new FormulaError('empty formula', 0)

  const expr = (): FormulaNode => {
    let left = term()
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = (tokens[k++] as { op: '+' | '-' }).op
      left = { type: 'bin', op, left, right: term() }
    }
    return left
  }
  const term = (): FormulaNode => {
    let left = unary()
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = (tokens[k++] as { op: '*' | '/' }).op
      left = { type: 'bin', op, left, right: unary() }
    }
    return left
  }
  const unary = (): FormulaNode => {
    if (isOp(peek(), '-')) {
      k++
      return { type: 'neg', arg: unary() }
    }
    return primary()
  }
  const primary = (): FormulaNode => {
    const t = peek()
    if (!t) throw new FormulaError('expected a number, a signal id or "(" but the formula ended', src.length)
    if (t.kind === 'num') {
      k++
      return { type: 'num', value: t.value }
    }
    if (isOp(t, '(')) {
      k++
      const inner = expr()
      if (!isOp(peek(), ')')) throw new FormulaError(`expected ")" but found ${describe(peek())}`, posOf(peek()))
      k++
      return inner
    }
    if (t.kind === 'id') {
      k++
      if (!t.quoted && isOp(peek(), '(')) {
        if (!(FORMULA_FNS as readonly string[]).includes(t.id)) {
          throw new FormulaError(`unknown function "${t.id}" (available: ${FORMULA_FNS.join(', ')})`, t.start)
        }
        k++
        const a = peek()
        if (a?.kind !== 'id') {
          throw new FormulaError(`${t.id}() takes a signal id, found ${describe(a)}`, posOf(a))
        }
        k++
        if (!isOp(peek(), ')')) throw new FormulaError(`expected ")" after ${t.id}(${a.id} but found ${describe(peek())}`, posOf(peek()))
        k++
        return { type: 'fn', fn: t.id as FormulaFn, arg: { type: 'ref', id: a.id, pos: a.start }, pos: t.start }
      }
      return { type: 'ref', id: t.id, pos: t.start }
    }
    throw new FormulaError(`expected a number, a signal id or "(" but found ${describe(t)}`, t.start)
  }

  const ast = expr()
  if (k < tokens.length) {
    const t = tokens[k]
    const hint =
      t.kind === 'id' || t.kind === 'num'
        ? ' (missing operator? binary minus between ids needs spaces: "a - b")'
        : ''
    throw new FormulaError(`unexpected ${describe(t)}${hint}`, t.start)
  }
  return ast
}

/** Every signal id the formula reads, unique, in order of first appearance. */
export function formulaRefs(ast: FormulaNode): string[] {
  const out: string[] = []
  const walk = (n: FormulaNode): void => {
    if (n.type === 'ref') {
      if (!out.includes(n.id)) out.push(n.id)
    } else if (n.type === 'fn') walk(n.arg)
    else if (n.type === 'neg') walk(n.arg)
    else if (n.type === 'bin') {
      walk(n.left)
      walk(n.right)
    }
  }
  walk(ast)
  return out
}

/** How an id is written in a formula: bare when the bare grammar can spell it, quoted otherwise. */
export function formatFormulaRef(id: string): string {
  return BARE_ID.test(id) && !id.endsWith('-') && !id.endsWith('.') ? id : `"${id}"`
}

/**
 * Rewrite every reference to `oldId` as `newId`, token by token: whitespace, numbers, operators and
 * other ids are left byte-for-byte as written. Never a string replace - `mrr` must not touch
 * `mrr-eu` or `churned-mrr`. A formula that does not parse is returned unchanged.
 */
export function renameFormulaRef(src: string, oldId: string, newId: string): string {
  let tokens: Token[]
  try {
    tokens = tokenize(src)
  } catch {
    return src
  }
  let out = ''
  let at = 0
  for (const t of tokens) {
    if (t.kind !== 'id' || t.id !== oldId) continue
    out += src.slice(at, t.start) + formatFormulaRef(newId)
    at = t.end
  }
  return out + src.slice(at)
}

// --- evaluation -----------------------------------------------------------------------------------

/** One input's full merged history, with the semantics needed to aggregate it. */
export interface FormulaInput {
  interval: SignalInterval
  accumulation: SignalAccumulation
  /** The FULL ascending merged history (never a windowed array). */
  merged: MergedSignalPoint[]
}

/** The bucket before `bucket` at the given interval. */
export function prevSignalBucket(bucket: string, interval: SignalInterval): string {
  return floorSignalBucket(new Date(Date.parse(bucket) - 1), interval)
}

interface IndexedInput {
  /** Bare value per formula bucket (sum for increment, last for snapshot). */
  bare: Map<string, number>
  /** End instant (ms) of each merged bucket, ascending, for start(). */
  ends: number[]
  values: number[]
}

function indexInput(input: FormulaInput, interval: SignalInterval): IndexedInput {
  const bare = new Map<string, number>()
  const ends: number[] = []
  const values: number[] = []
  for (const p of input.merged) {
    const b = floorSignalBucket(p.bucket, interval)
    bare.set(b, input.accumulation === 'increment' ? (bare.get(b) ?? 0) + p.value : p.value)
    ends.push(Date.parse(nextSignalBucket(p.bucket, input.interval)))
    values.push(p.value)
  }
  return { bare, ends, values }
}

/** The value of the latest input bucket that ended on or before `at` (binary search). */
function levelBefore(ix: IndexedInput, at: number): number | null {
  let lo = 0
  let hi = ix.ends.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ix.ends[mid] <= at) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit < 0 ? null : ix.values[hit]
}

/**
 * Compute a formula's value per bucket of `interval`, over the union of its inputs' buckets.
 * Inputs absent from `inputs` are missing (every bucket that reads them produces no point).
 * Returns ascending { bucket, value } pairs; buckets that evaluate to nothing are omitted.
 */
export function computeFormulaPoints(
  interval: SignalInterval,
  ast: FormulaNode,
  inputs: ReadonlyMap<string, FormulaInput>,
): { bucket: string; value: number }[] {
  const indexed = new Map<string, IndexedInput>()
  for (const id of formulaRefs(ast)) {
    const input = inputs.get(id)
    if (input) indexed.set(id, indexInput(input, interval))
  }
  const buckets = new Set<string>()
  for (const ix of indexed.values()) for (const b of ix.bare.keys()) buckets.add(b)

  const evaluate = (n: FormulaNode, bucket: string): number | null => {
    switch (n.type) {
      case 'num':
        return n.value
      case 'ref':
        return indexed.get(n.id)?.bare.get(bucket) ?? null
      case 'fn': {
        const ix = indexed.get(n.arg.id)
        if (!ix) return null
        if (n.fn === 'prev') return ix.bare.get(prevSignalBucket(bucket, interval)) ?? null
        return levelBefore(ix, Date.parse(bucket))
      }
      case 'neg': {
        const v = evaluate(n.arg, bucket)
        return v === null ? null : -v
      }
      case 'bin': {
        const l = evaluate(n.left, bucket)
        if (l === null) return null
        const r = evaluate(n.right, bucket)
        if (r === null) return null
        if (n.op === '+') return l + r
        if (n.op === '-') return l - r
        if (n.op === '*') return l * r
        return r === 0 ? null : l / r
      }
    }
  }

  const out: { bucket: string; value: number }[] = []
  for (const bucket of [...buckets].sort()) {
    const v = evaluate(ast, bucket)
    if (v !== null && Number.isFinite(v)) out.push({ bucket, value: v })
  }
  return out
}

/**
 * Lay a formula signal's own MANUAL points over its computed ones (see the header: the correction
 * wins). Stored live rows are ignored. Manual points are re-floored to the current interval (last
 * written wins a collapsed bucket). `from` clips the result (buckets >= floor(from)). No zero-fill:
 * an empty bucket is a gap, never 0.
 */
export function mergeFormulaPoints(
  interval: SignalInterval,
  computed: { bucket: string; value: number }[],
  own: StorePoint[],
  opts: { from?: string } = {},
): MergedSignalPoint[] {
  const manual = new Map<string, { value: number; note: string | null }>()
  for (const p of [...own].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
    if (p.source === 'manual') manual.set(floorSignalBucket(p.bucket, interval), { value: p.value, note: p.note })
  }
  const byBucket = new Map<string, MergedSignalPoint>()
  for (const c of computed) {
    byBucket.set(c.bucket, { bucket: c.bucket, value: c.value, source: 'live', note: null, computed: true })
  }
  for (const [bucket, m] of manual) {
    const c = byBucket.get(bucket)
    byBucket.set(bucket, {
      bucket,
      value: m.value,
      source: 'manual',
      note: m.note,
      ...(c ? { shadowed_computed: c.value } : {}),
    })
  }
  const from = opts.from ? floorSignalBucket(opts.from, interval) : null
  return [...byBucket.values()]
    .filter((p) => from === null || p.bucket >= from)
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// --- the history resolver (every read path) -------------------------------------------------------

const parsed = new Map<string, FormulaNode | null>()

/** Parse with a small cache; a formula that no longer parses reads as null (no history). */
export function parseFormulaCached(src: string): FormulaNode | null {
  if (!parsed.has(src)) {
    let ast: FormulaNode | null = null
    try {
      ast = parseFormula(src)
    } catch {
      ast = null
    }
    if (parsed.size > 500) parsed.clear()
    parsed.set(src, ast)
  }
  return parsed.get(src)!
}

/** The formula's refs, or [] when it does not parse. */
export function formulaRefsOf(src: string | null | undefined): string[] {
  if (!src) return []
  const ast = parseFormulaCached(src)
  return ast ? formulaRefs(ast) : []
}

export type HistoryDefinition = Pick<SignalDefinition, 'id' | 'interval' | 'accumulation'> & {
  formula?: string | null
}

/** What the resolver reads: definitions, and each signal's stored rows from both stores. */
export interface SignalHistorySource {
  definition(id: string): HistoryDefinition | undefined
  stored(id: string): { points: StorePoint[] }
}

/**
 * One signal's FULL merged history: mergeSignalPoints for an ordinary signal, computed + manual
 * overrides for a formula signal (inputs resolved recursively). `memo` is shared across calls so a
 * bulk read resolves each signal once; a cycle resolves to [].
 */
export function resolveSignalHistory(
  id: string,
  source: SignalHistorySource,
  memo: Map<string, MergedSignalPoint[]> = new Map(),
  opts: { now?: Date } = {},
  visiting: Set<string> = new Set(),
): MergedSignalPoint[] {
  const hit = memo.get(id)
  if (hit) return hit
  const def = source.definition(id)
  if (!def || visiting.has(id)) return []
  const stored = source.stored(id)
  if (!def.formula) {
    const merged = mergeSignalPoints(def, stored.points, { now: opts.now })
    memo.set(id, merged)
    return merged
  }
  visiting.add(id)
  const ast = parseFormulaCached(def.formula)
  const inputs = new Map<string, FormulaInput>()
  for (const ref of ast ? formulaRefs(ast) : []) {
    const refDef = source.definition(ref)
    if (!refDef || visiting.has(ref)) continue
    inputs.set(ref, {
      interval: refDef.interval,
      accumulation: refDef.accumulation,
      merged: resolveSignalHistory(ref, source, memo, opts, visiting),
    })
  }
  visiting.delete(id)
  const merged = mergeFormulaPoints(def.interval, ast ? computeFormulaPoints(def.interval, ast, inputs) : [], stored.points)
  memo.set(id, merged)
  return merged
}
