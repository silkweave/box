// Moved to the component library (@silkweave/box-ui): the column model is geometry and a pair of
// localStorage-backed hooks, with no vocabulary in it, and `GridHeader` / `GridFooter` are the two
// components that read it. This is the app's alias onto that one instance, kept so the three list
// views keep importing `@/lib/gridColumns` and so a Box that swaps the grid out has one file to
// change.
export {
  AGGREGATE_LABEL,
  AGGREGATE_METHODS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  aggregate,
  aggregateDecimals,
  aggregateSources,
  buildGrid,
  clampWidth,
  orderColumns,
  useColumnAggregates,
  useColumnWidths,
  type Aggregatable,
  type AggregateMethod,
  type AggregateSource,
  type AggregateSources,
  type AggregateStore,
  type AggregateUnit,
  type ColumnDef,
  type ColumnWidths,
  type ColumnWidthStore,
  type GridColumn,
  type GridLayout,
  type GridSpec,
} from '@silkweave/box-ui'
