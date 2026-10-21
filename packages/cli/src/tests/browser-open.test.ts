import { describe, expect, it } from 'vitest'
import { browserLaunchers } from '../command-ui.js'

describe('browser launchers', () => {
  const url = 'http://localhost:8190/login/grant?a=1&b=2'

  it('uses the platform opener on macOS, Windows and Linux', () => {
    expect(browserLaunchers(url, 'darwin', false)).toEqual([['open', [url]]])
    expect(browserLaunchers(url, 'win32', false)).toEqual([['cmd', ['/c', 'start', '', url]]])
    expect(browserLaunchers(url, 'linux', false)).toEqual([['xdg-open', [url]]])
  })

  it('reaches the Windows browser from WSL, escaping cmd metacharacters', () => {
    const launchers = browserLaunchers(url, 'linux', true)
    expect(launchers.map(([program]) => program)).toEqual(['wslview', 'cmd.exe', 'xdg-open'])
    expect(launchers[1]![1]).toEqual(['/c', 'start', '', 'http://localhost:8190/login/grant?a=1^&b=2'])
  })
})
