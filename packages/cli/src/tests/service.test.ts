import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launchdPlist, rotateLog, parseLaunchdPrint, parseSystemdShow, serviceName, servicePlatform, serviceSpec, systemdUnit, SERVICE_LAUNCHER, SUPERVISOR_ARGS } from '../service.ts'

test('service names are per checkout and safe for systemd and launchd', () => {
  const a = serviceName('/home/toby/My Box', 'systemd')
  assert.match(a, /^silkweave-box-my-box-[0-9a-f]{8}$/)
  assert.notEqual(a, serviceName('/srv/My Box', 'systemd'))
  assert.match(serviceName('/Users/toby/box', 'launchd'), /^dev\.silkweave\.box\.box-[0-9a-f]{8}$/)
})

test('the service PATH keeps the shell PATH and adds the running Bun', () => {
  const spec = serviceSpec('/home/a/box', 'systemd', { bun: '/home/a/.bun/bin/bun', path: '/home/a/.local/bin:/usr/bin' })
  assert.equal(spec.path, '/home/a/.bun/bin:/home/a/.local/bin:/usr/bin:/usr/local/bin:/bin')
  assert.equal(spec.log, '/home/a/box/data/logs/service.log')
  assert.equal(serviceSpec('/b', 'systemd', { bun: '/x/bun', path: '/x:/usr/local/bin:/usr/bin:/bin' }).path, '/x:/usr/local/bin:/usr/bin:/bin')
})

test('the systemd unit runs the supervisor in built mode and quotes paths', () => {
  const spec = serviceSpec('/home/a/my box', 'systemd', { bun: '/home/a/.bun/bin/bun', path: '/usr/bin:/100%' })
  const unit = systemdUnit(spec)
  assert.match(unit, /^WorkingDirectory=\/home\/a\/my box$/m)
  assert.match(unit, /^Environment=PATH=\/home\/a\/\.bun\/bin:\/usr\/bin:\/100%%:\/usr\/local\/bin:\/bin$/m)
  assert.match(unit, new RegExp(`^ExecStart=/home/a/\\.bun/bin/bun ${SUPERVISOR_ARGS.join(' ').replace(/[.]/g, '\\.')}$`, 'm'))
  assert.doesNotMatch(unit, /--dev/)
  assert.match(unit, /^KillMode=mixed$/m)
  assert.match(unit, /^Restart=on-failure$/m)
  assert.doesNotMatch(unit, /StandardOutput/)
  assert.match(unit, /^WantedBy=default\.target$/m)
})

test('the launchd agent runs in the Standard band and escapes XML', () => {
  const spec = serviceSpec('/Users/a/R&D box', 'launchd', { bun: '/opt/homebrew/bin/bun', path: '/opt/homebrew/bin:/usr/bin:/bin' })
  const plist = launchdPlist(spec)
  assert.match(plist, /<string>\/Users\/a\/R&amp;D box<\/string>/)
  assert.match(plist, /<key>ProcessType<\/key>\n\t<string>Standard<\/string>/)
  assert.match(plist, /<key>SuccessfulExit<\/key>\n\t\t<false\/>/)
  assert.match(plist, /<string>apps\/server\/src\/builder\/supervisor\.ts<\/string>/)
  assert.doesNotMatch(plist, /--dev/)
})

test('the launchd agent starts Box.app with Bun when Box Setup put it in data/service', () => {
  const root = mkdtempSync(join(tmpdir(), 'box-service-'))
  try {
    const bare = serviceSpec(root, 'launchd', { bun: '/opt/homebrew/bin/bun', path: '/usr/bin' })
    assert.equal(bare.launcher, undefined)
    assert.match(launchdPlist(bare), /<array>\n\t\t<string>\/opt\/homebrew\/bin\/bun<\/string>/)
    const launcher = join(root, SERVICE_LAUNCHER)
    mkdirSync(dirname(launcher), { recursive: true })
    writeFileSync(launcher, '')
    const spec = serviceSpec(root, 'launchd', { bun: '/opt/homebrew/bin/bun', path: '/usr/bin' })
    assert.equal(spec.launcher, launcher)
    assert.ok(launchdPlist(spec).includes(`<array>\n\t\t<string>${launcher}</string>\n\t\t<string>/opt/homebrew/bin/bun</string>\n\t\t<string>--no-env-file</string>`))
    assert.equal(serviceSpec(root, 'systemd', { bun: '/usr/bin/bun', path: '/usr/bin' }).launcher, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('service state parsing', () => {
  assert.deepEqual(parseSystemdShow('LoadState=loaded\nActiveState=active\nMainPID=4242\n'), { installed: true, running: true, pid: 4242, detail: 'active' })
  assert.deepEqual(parseSystemdShow('LoadState=loaded\nActiveState=failed\nMainPID=0\n'), { installed: true, running: false, detail: 'failed' })
  assert.deepEqual(parseLaunchdPrint('gui/501/x = {\n\tstate = running\n\tpid = 99\n}'), { running: true, pid: 99, detail: 'running' })
  assert.deepEqual(parseLaunchdPrint('gui/501/x = {\n\tstate = not running\n}'), { running: false, detail: 'not running' })
})

test('service platform: launchd on macOS, systemd only when the user manager answers', () => {
  const answers = (status: number) => () => ({ status, stdout: '', stderr: '' })
  assert.deepEqual(servicePlatform(answers(1), 'darwin'), { platform: 'launchd' })
  assert.deepEqual(servicePlatform(answers(0), 'linux'), { platform: 'systemd' })
  assert.equal(servicePlatform(answers(1), 'linux').platform, null)
  assert.equal(servicePlatform(answers(0), 'win32').platform, null)
})

test('the launchd log keeps one previous file once it passes the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'box-service-log-'))
  try {
    const log = join(dir, 'service.log')
    assert.equal(rotateLog(log, 10), false)
    writeFileSync(log, '12345')
    assert.equal(rotateLog(log, 10), false)
    writeFileSync(log, '12345678901')
    assert.equal(rotateLog(log, 10), true)
    assert.equal(existsSync(log), false)
    assert.equal(existsSync(`${log}.1`), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
