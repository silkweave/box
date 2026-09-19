// The slice of the signal vocabulary a provider's measure catalogue has to speak: how wide one
// point is, what a point MEANS, and which way is good. These three live here rather than in
// @silkweave/box-core because a measure declares defaults in them - if they stayed in core, either every
// provider would depend on the warehouse layer (the dependency cycle the packaging exists to
// prevent) or the vocabulary would be duplicated and drift. Core re-exports them from
// signals/types.ts, so `import { SIGNAL_INTERVALS } from '@silkweave/box-core'` keeps working verbatim.
//
// Deliberately NOT here: SignalSource (derived|manual) and SignalPointSource (manual|live). Those
// describe where a warehouse ROW came from, which is exactly the layer a provider cannot see.

/**
 * The bucket width one point represents. A provider declares its measure's natural grain; the
 * binding signal may override it, and every write floors through core's one bucketing helper.
 */
export type SignalInterval = 'hour' | 'day' | 'week' | 'month'
export const SIGNAL_INTERVALS: SignalInterval[] = ['hour', 'day', 'week', 'month']

/**
 * What a point MEANS. `snapshot` = the whole value at that time (cash balance, followers);
 * `increment` = occurrences accumulated into the interval bucket (invitations sent that day).
 */
export type SignalAccumulation = 'snapshot' | 'increment'
export const SIGNAL_ACCUMULATIONS: SignalAccumulation[] = ['snapshot', 'increment']

/** Is up good? Churn is a `down` signal - health/deltas color by this instead of assuming growth. */
export type SignalDirection = 'up' | 'down'
export const SIGNAL_DIRECTIONS: SignalDirection[] = ['up', 'down']
