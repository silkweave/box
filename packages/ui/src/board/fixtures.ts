// A small board for the board stories: four columns and six cards, one of them unowned and one with
// no value, so the column badge and the card body both have a blank to render.
import { CircleCheck, CircleDashed, CircleDot, CircleSlash } from 'lucide-react'
import type { KanbanColumn } from './BoardKanban.tsx'

export interface Card {
  id: string
  title: string
  owner: string | null
  value: number | null
  column: string
}

export const COLUMNS: KanbanColumn[] = [
  { key: 'new', label: 'New', icon: CircleDashed, color: 'text-muted-foreground' },
  { key: 'active', label: 'Active', icon: CircleDot, color: 'text-accent' },
  { key: 'done', label: 'Done', icon: CircleCheck, color: 'text-success', terminal: true },
  { key: 'dropped', label: 'Dropped', icon: CircleSlash, color: 'text-fg-4', terminal: true },
]

export const CARDS: Card[] = [
  { id: '1', title: 'Northwind Traders', owner: 'ada', value: 4200, column: 'new' },
  { id: '2', title: 'Contoso', owner: 'grace', value: 1150, column: 'active' },
  { id: '3', title: 'Fabrikam', owner: null, value: null, column: 'active' },
  { id: '4', title: 'Tailspin Toys', owner: 'alan', value: 900, column: 'active' },
  { id: '5', title: 'Proseware', owner: 'ada', value: 2400, column: 'done' },
  { id: '6', title: 'Litware', owner: 'grace', value: 300, column: 'dropped' },
]
