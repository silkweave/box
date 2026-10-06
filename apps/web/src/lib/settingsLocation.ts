export function parseSettingsHash(hash: string) {
  const raw = hash.replace(/^#/, '')
  if (raw !== 'settings' && !raw.startsWith('settings/')) return undefined
  const [, section = 'profile', ...params] = raw.split('/')
  if (section === 'schedules') return { section: 'automation', params: ['schedules', ...params] }
  // The alert rules are deliver triggers now.
  if (section === 'rules') return { section: 'automation', params: ['triggers'] }
  return { section: section || 'profile', params }
}

export function settingsHash(path = '') { return `settings${path ? `/${path}` : ''}` }
