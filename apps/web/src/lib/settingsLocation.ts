export function parseSettingsHash(hash: string) {
  const raw = hash.replace(/^#/, '')
  if (raw !== 'settings' && !raw.startsWith('settings/')) return undefined
  const [, section = 'profile', ...params] = raw.split('/')
  if (section === 'schedules') return { section: 'automation', params: ['schedules', ...params] }
  if (section === 'rules') return { section: 'alerts', params: ['rules', ...params] }
  return { section: section || 'profile', params }
}

export function settingsHash(path = '') { return `settings${path ? `/${path}` : ''}` }
