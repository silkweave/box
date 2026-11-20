// The settings vocabulary: the pane, its slots, pages, headers, tabs, groups, lists, facts,
// control rows, toolbar, states and forms. The pane's publish contexts and the canvas plumbing in
// `internal.tsx` stay internal.
export { SettingsPane, SettingsFooterBar, SETTINGS_GUTTER, type SettingsFooter } from './SettingsPane.tsx'
export { useSettingsFooter, SettingsActions, SettingsHeaderActions, SettingsInfo, SettingsIntro } from './slots.tsx'
export { SettingsPage } from './SettingsPage.tsx'
export { SettingsDetailHeader } from './SettingsDetailHeader.tsx'
export { SettingsTabs } from './SettingsTabs.tsx'
export { SettingsGroup } from './SettingsGroup.tsx'
export { SettingsFacts, SettingsFact } from './SettingsFacts.tsx'
export { SettingsControlList, SettingsControlRow } from './SettingsControlRow.tsx'
export { SettingsEmpty, SettingsNotice, SettingsChangedFrom, SettingsLoading, SettingsError, SettingsReadOnly, useSettingsReadOnly } from './states.tsx'
export { useSettingsForm, SettingsSaveBar, SettingsDeleteButton, type SettingsForm } from './form.tsx'
export type { SettingsLeaveState } from './internal.tsx'
