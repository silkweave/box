// The rendered gate's vocabulary: a spec names a story, the themes and widths it runs under, and
// checks the page with the helpers below. Specs live beside this file as `*.spec.ts`; `run.ts`
// builds Storybook, serves it and runs them in headless Chromium.
//
// What belongs in a spec: what a person would see is wrong. A glyph off-centre in its button, a
// branch whose resting look differs from its sibling's, a control that does not open, pick, clear
// or return focus. Measure the element that carries the meaning (the glyph, not only its button),
// and require exactly one match so a probe cannot pass on the wrong element.

import type { Locator, Page } from 'playwright-core'

export type Theme = 'light' | 'dark'

export interface RenderedSpec {
  /** Storybook story id, e.g. `grid-cells--select-threshold`. */
  story: string
  name: string
  /** Defaults to both. */
  themes?: Theme[]
  /** Viewport widths to run at; defaults to [1280]. Height is 900. */
  widths?: number[]
  run: (ctx: SpecContext) => Promise<void>
}

export interface SpecContext {
  page: Page
  theme: Theme
  /** The viewport width this run uses. */
  width: number
  /**
   * Compare a screenshot of `target` (default the story's `data-shot` element, else its root) with its reviewed baseline in
   * `screens/`. Fails on any visible difference, writing the new image and a diff to
   * `node_modules/.cache/rendered-diffs/`; `--accept` writes the new image as the baseline, which a
   * person must look at first: a baseline is a reviewed picture, never whatever the code drew.
   */
  screenshot: (name: string, target?: Locator) => Promise<void>
  /** The one element with `data-fixture=<id>`; fails unless exactly one exists. */
  fixture: (id: string) => Promise<Locator>
}

export class SpecFailure extends Error {}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SpecFailure(message)
}

/** The one match of `locator`; fails on none or several. */
export async function one(locator: Locator, what: string): Promise<Locator> {
  const n = await locator.count()
  check(n === 1, `${what}: expected exactly one match, found ${n}`)
  return locator
}

export interface Rect { x: number; y: number; width: number; height: number }

export async function rect(locator: Locator, what: string): Promise<Rect> {
  const box = await (await one(locator, what)).boundingBox()
  check(box, `${what}: not rendered`)
  return box
}

/** `inner`'s centre lies within `tolerance` CSS px of `outer`'s, on both axes. */
export async function expectCentered(outer: Locator, inner: Locator, what: string, tolerance = 1): Promise<void> {
  const o = await rect(outer, `${what} (container)`)
  const i = await rect(inner, `${what} (content)`)
  const dx = i.x + i.width / 2 - (o.x + o.width / 2)
  const dy = i.y + i.height / 2 - (o.y + o.height / 2)
  check(
    Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance,
    `${what}: content is off-centre by ${dx.toFixed(1)}px x, ${dy.toFixed(1)}px y (left ${(i.x - o.x).toFixed(1)}, right ${(o.x + o.width - i.x - i.width).toFixed(1)})`,
  )
}

/** `locator` measures `width` x `height` within `tolerance` px. */
export async function expectSize(locator: Locator, width: number, height: number, what: string, tolerance = 0.5): Promise<void> {
  const r = await rect(locator, what)
  check(Math.abs(r.width - width) <= tolerance && Math.abs(r.height - height) <= tolerance, `${what}: ${r.width}x${r.height}, expected ${width}x${height}`)
}

/** `inner` lies inside `outer` (nothing clipped or spilling over the host). */
export async function expectInside(outer: Locator, inner: Locator, what: string, tolerance = 0.5): Promise<void> {
  const o = await rect(outer, `${what} (host)`)
  const i = await rect(inner, `${what} (content)`)
  check(
    i.x >= o.x - tolerance && i.y >= o.y - tolerance && i.x + i.width <= o.x + o.width + tolerance && i.y + i.height <= o.y + o.height + tolerance,
    `${what}: content ${JSON.stringify(i)} spills out of its host ${JSON.stringify(o)}`,
  )
}
