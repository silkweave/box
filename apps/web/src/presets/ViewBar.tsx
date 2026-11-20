// The bar spec a preset board hands `DataGrid` as `bar`: the library's spec plus the one line only
// the preset control needs. The grid draws the bar; `PresetPicker` goes in its `presets` slot.

import type { BoardBarSpec } from '@silkweave/box-ui/board'

export type ViewBarSpec = BoardBarSpec & {
  /** What saving captures, e.g. "the current layout, filters, grouping and columns". */
  savesHint: string
}
