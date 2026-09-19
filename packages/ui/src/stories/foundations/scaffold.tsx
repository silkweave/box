import * as React from 'react'
import { Stage } from '../Stage.tsx'

/**
 * Shared furniture for the Foundations pages.
 *
 * These pages document the token system itself, so - unlike a component story -
 * they are allowed to read `var(--token)` directly: showing a swatch of
 * `--bg-surface` IS the story. Everywhere else in the library, raw var() is a
 * smell and the Tailwind utility from globals.css `@theme` is the right call.
 */

export function Page({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <Stage>
      <div className="max-w-reading">
        <h1 className="text-display-md font-semibold text-text">{title}</h1>
        <p className="mt-2 text-body text-muted-foreground">{lede}</p>
        <div className="mt-8 flex flex-col gap-10">{children}</div>
      </div>
    </Stage>
  )
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-label font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h2>
      {note ? <p className="mt-1 text-body-sm text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** A token row: the name you type, and what it renders as. */
export function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-2.5 last:border-b-0">
      <code className="w-56 shrink-0 font-mono text-code text-muted-foreground">{name}</code>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
