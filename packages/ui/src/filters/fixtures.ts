// One field of each type, for the filter kit's stories and the bar's: enough options on the person
// field to bring out its search box, a deadline-style date, an hours number and two flags' words.
import { FORWARD_WINDOWS, type FilterField } from './types.ts'

export const STATUS_FIELD: FilterField = {
  key: 'status',
  title: 'Status',
  type: 'options',
  options: [
    { value: 'new', label: 'New' },
    { value: 'active', label: 'Active' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'done', label: 'Done' },
  ],
}

export const OWNER_FIELD: FilterField = {
  key: 'owner',
  title: 'Owner',
  type: 'person',
  noneLabel: 'No owner',
  options: ['Ada', 'Grace', 'Alan', 'Katherine', 'Barbara', 'Edsger', 'Donald', 'Frances', 'Margaret'].map((n) => ({ value: n.toLowerCase(), label: n })),
}

export const DUE_FIELD: FilterField = { key: 'due', title: 'Due', type: 'date', windows: FORWARD_WINDOWS, noneLabel: 'No due date' }

export const ESTIMATE_FIELD: FilterField = { key: 'estimate', title: 'Estimate', type: 'number', unit: 'h', step: 0.5 }

export const NOTE_FIELD: FilterField = { key: 'note', title: 'Notes', type: 'text', placeholder: 'Contains...' }

export const FLAG_FIELD: FilterField = {
  key: 'flagged',
  title: 'Flagged',
  type: 'boolean',
  onLabel: 'Flagged',
  offLabel: 'Not flagged',
  note: 'A row nobody has flagged counts as not flagged.',
}

export const FIELDS: FilterField[] = [STATUS_FIELD, OWNER_FIELD, DUE_FIELD, ESTIMATE_FIELD, NOTE_FIELD, FLAG_FIELD]

/** The clock the stories read dates on, so a story looks the same whichever day it is opened. */
export const STORY_TODAY = '2026-10-30'
