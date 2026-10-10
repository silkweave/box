// Core's own circuit-board node kind: a signal, drawn with its latest value, the change against the
// previous bucket and a sparkline of recent buckets. Its edges are `depends_on` (driver -> signal).
// Registered by the server's SignalsModule; see ./board-kinds.ts.

import { readDataSources } from './sources/state.js'
import { formatBoardNumber, type BoardEdgeRef, type BoardNodeCard, type BoardNodeKind, type BoardTone } from './board-kinds.js'
import { readSignalDefinitions } from './definitions.js'
import { readSignalPoints } from './points.js'
import type { SignalDefinition } from './types.js'

const INTERVAL_WORD: Record<SignalDefinition['interval'], string> = { hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly' }
const SPARK_BUCKETS = 20
const STALE_SYNC_MS = 2 * 24 * 60 * 60 * 1000

/** The detail route segment: the id without its `<channel>.` prefix, non-alphanumerics dashed
 *  (mirrors web/lib/signalSlug.ts). */
function signalSlug(s: Pick<SignalDefinition, 'id' | 'channel'>): string {
  const tail = s.id.startsWith(`${s.channel}.`) ? s.id.slice(s.channel.length + 1) : s.id
  return tail.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const channelTitle = (c: string): string => {
  const [base, account] = c.split('@')
  const word = base.charAt(0).toUpperCase() + base.slice(1)
  return account ? `${word} · ${account}` : word
}

const day = (bucket: string): string => bucket.slice(0, 10)

export const SIGNAL_BOARD_KIND: BoardNodeKind = {
  kind: 'signal',
  label: 'Signals',
  layer: 2,
  watch: ['table:signals', 'table:signal_points', 'table:data_sources'],

  async exists(refs) {
    const ids = new Set((await readSignalDefinitions()).map((d) => d.id))
    return new Set(refs.filter((r) => ids.has(r)))
  },

  async resolve(refs) {
    const wanted = new Set(refs)
    const defs = (await readSignalDefinitions()).filter((d) => wanted.has(d.id))
    const sources = new Map((await readDataSources()).map((s) => [s.id, s]))
    const out = new Map<string, BoardNodeCard>()
    for (const d of defs) {
      const points = await readSignalPoints(d.id)
      const latest = points.at(-1) ?? null
      const prev = points.at(-2) ?? null
      const delta = latest && prev && prev.value !== 0 ? ((latest.value - prev.value) / Math.abs(prev.value)) * 100 : null
      // A rise is not automatically good: a `down` signal improving means going down.
      const tone: BoardTone =
        delta == null || Math.abs(delta) < 0.05 ? 'neutral' : delta > 0 === (d.direction !== 'down') ? 'success' : 'danger'

      let footer = latest ? `as of ${day(latest.bucket)}` : 'no data yet'
      let footerTone: BoardTone = 'neutral'
      if (d.data_source_id) {
        const source = sources.get(d.data_source_id)
        if (!source) {
          footer = `source ${d.data_source_id} is gone`
          footerTone = 'danger'
        } else if (source.last_sync_status === 'error') {
          footer = `last sync via ${source.label} failed`
          footerTone = 'danger'
        } else {
          const stale = !!source.last_sync_at && Date.now() - new Date(source.last_sync_at).getTime() > STALE_SYNC_MS
          footer = `via ${source.label}${source.last_sync_at ? ` · ${day(source.last_sync_at)}` : ' · never synced'}${stale ? ' · stale' : ''}`
          footerTone = stale ? 'warning' : 'neutral'
        }
      }

      out.set(d.id, {
        title: d.label,
        subtitle: d.formula ? `${INTERVAL_WORD[d.interval]} · formula` : INTERVAL_WORD[d.interval],
        value: latest ? formatBoardNumber(latest.value) : null,
        unit: d.unit,
        badge: delta == null ? null : { label: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`, tone },
        sparkline: points.slice(-SPARK_BUCKETS).map((p) => p.value),
        footer,
        footerTone,
        href: `/signals/${encodeURIComponent(d.channel)}/${signalSlug(d)}`,
        details: [
          { label: 'Channel', value: channelTitle(d.channel) },
          { label: 'Interval', value: INTERVAL_WORD[d.interval] },
          ...(d.formula ? [{ label: 'Formula', value: d.formula }] : []),
          { label: 'Direction', value: d.direction === 'down' ? 'lower is better' : 'higher is better' },
          ...(latest ? [{ label: 'Latest', value: `${formatBoardNumber(latest.value)}${d.unit ? ` ${d.unit}` : ''} (${day(latest.bucket)})` }] : []),
          ...(d.owner ? [{ label: 'Owner', value: d.owner }] : []),
        ],
      })
    }
    return out
  },

  async candidates() {
    return (await readSignalDefinitions()).map((d) => ({ ref: d.id, title: d.label, group: channelTitle(d.channel) }))
  },

  async edges(nodes) {
    const mine = new Set(nodes.filter((n) => n.kind === 'signal').map((n) => n.ref))
    if (mine.size === 0) return []
    const out: BoardEdgeRef[] = []
    for (const d of await readSignalDefinitions()) {
      for (const dep of d.depends_on) {
        if (mine.has(d.id) || mine.has(dep)) out.push({ source: { kind: 'signal', ref: dep }, target: { kind: 'signal', ref: d.id } })
      }
    }
    return out
  },
}
