// A tiny board for the grid stories: four columns of a shape the components can actually total.
import type { Aggregatable, ColumnDef, GridSpec } from './columns.ts'

export interface Row {
  id: string
  name: string
  owner: string
  revenue: number | null
  probability: number | null
}

export const ROWS: Row[] = [
  { id: '1', name: 'Northwind Traders', owner: 'ada', revenue: 4200, probability: 0.8 },
  { id: '2', name: 'Contoso', owner: 'grace', revenue: 1150, probability: 0.35 },
  { id: '3', name: 'Fabrikam', owner: 'ada', revenue: null, probability: 0.1 },
  { id: '4', name: 'Tailspin Toys', owner: 'linus', revenue: 900, probability: 0.6 },
]

export const SPEC: GridSpec = {
  name: { key: 'name', label: 'Name', min: 220 },
  fixed: [{ key: 'owner', label: 'Owner', width: 120 }],
  actions: 64,
}

export const CATALOG: (ColumnDef & { agg?: Aggregatable<Row> })[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    width: '140px',
    hint: 'Recognised revenue for the current month',
    agg: { value: (r) => r.revenue, unit: 'currency' },
  },
  {
    key: 'probability',
    label: 'Probability',
    width: '140px',
    agg: { value: (r) => (r.probability == null ? null : r.probability * 100), unit: 'percent' },
  },
]

export const SELECTED = ['revenue', 'probability']
