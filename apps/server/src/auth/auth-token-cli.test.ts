import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const flags = ['--conditions=@silkweave/box-source', '--import', '@swc-node/register/esm-register']

function fixture(run: (box: ReturnType<typeof commands>) => void): void {
  const cache = join(root, 'node_modules', '.cache')
  mkdirSync(cache, { recursive: true })
  const data = mkdtempSync(join(cache, 'auth-create-'))
  try { run(commands(data)) } finally { rmSync(data, { recursive: true, force: true }) }
}

function commands(data: string) {
  // The scripts run in a child process, which no in-process call can redirect - so a preload does
  // it: `--import` runs this module before the script's own imports evaluate, and it calls the
  // same `setInstanceDir()` seam typegen uses, one process boundary away. Same module instance as
  // the script's core (`packages/core/src/io.ts` resolves to one URL either way), so the script
  // reads the throwaway directory and never the checkout's data/.
  const preload = join(data, 'instance-dir.mjs')
  writeFileSync(preload, [
    `import { setInstanceDir } from ${JSON.stringify(pathToFileURL(join(root, 'packages/core/src/testing.ts')).href)}`,
    `setInstanceDir(${JSON.stringify(data)})`,
    '',
  ].join('\n'))
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.BOX_DATA_DIR // refused by instanceDir() if a shell still exports it; not this test's subject
  const node = (args: string[]) => spawnSync(process.execPath, [...flags, '--import', pathToFileURL(preload).href, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 30_000,
  })
  const token = (...args: string[]) => node(['apps/server/scripts/auth-token.ts', ...args, '--quiet'])
  const ok = (...args: string[]) => {
    const result = token(...args)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('the token itself is not printed')
    expect(result.stdout).toContain('/login?link=')
    expect(result.stdout).not.toMatch(/^\s+[A-Za-z0-9_-]{32}\s*$/m)
    return result
  }
  // Return a digest, never a permanent credential, from the separate warehouse reader.
  const state = (id: string, revoke = false) => {
    const result = node(['--input-type=module', '-e', `
      import { ensureSchema, readUser, upsertUser, revealPrincipalToken, authenticatePrincipal } from './packages/core/src/index.ts';
      import { createHash } from 'node:crypto';
      await ensureSchema();
      const id = ${JSON.stringify(id)};
      if (${revoke}) await upsertUser({ id, status: 'revoked' });
      const user = await readUser(id);
      const token = await revealPrincipalToken(id);
      const principal = token ? await authenticatePrincipal(token) : null;
      console.log(JSON.stringify({ user, authenticatedRole: principal?.role, authenticatedName: principal?.display, tokenHash: token ? createHash('sha256').update(token).digest('hex') : null }));
      process.exit(0);
    `])
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as {
      user: { role: string; first_name: string; last_name: string; nickname: string; status: string } | null
      tokenHash: string | null
      authenticatedRole?: string
      authenticatedName?: string
    }
  }
  const configure = (id: string, role = 'admin') => {
    writeFileSync(join(data, 'box.json'), JSON.stringify({ agent: { id, name: 'Orion', role } }))
  }
  const configureLocal = (agent: Record<string, string>) => {
    writeFileSync(join(data, 'box.local.json'), JSON.stringify({ agent }))
  }
  const removeIdentityConfig = () => {
    rmSync(join(data, 'box.json'))
    rmSync(join(data, 'config', 'agent-identity.lock.json'))
  }
  return { token, ok, state, configure, configureLocal, removeIdentityConfig }
}

test('bootstrap stays automatic; additional users require create and default to member', () => fixture(({ token, ok, state }) => {
  ok('alice', '--name', 'Alice Example')
  expect(state('alice').user).toMatchObject({ role: 'admin', first_name: 'Alice', last_name: 'Example' })
  expect(token('bob').status).toBe(1)
  expect(state('bob').user).toBeNull()
  ok('bob', '--create', '--name', 'Bob Example')
  const before = state('bob')
  expect(before.user).toMatchObject({ role: 'member', first_name: 'Bob', last_name: 'Example' })
  expect(before.tokenHash).not.toBeNull()
  expect(token('bob').status).toBe(1)
  expect(state('bob')).toEqual(before)
  ok('bob', '--rotate')
  expect(state('bob').tokenHash).not.toBe(before.tokenHash)
}), 60_000)

test('custom agent tokens work without browser links, and host role changes preserve their credentials', () => fixture(({ token, ok, state, configure }) => {
  configure('orion')
  const minted = token('orion')
  expect(minted.status, minted.stderr).toBe(0)
  expect(minted.stdout).not.toContain('/login?link=')
  expect(minted.stdout).not.toMatch(/^\s+[A-Za-z0-9_-]{32}\s*$/m)
  const initial = state('orion')
  expect(initial.user?.first_name).toBe('Orion')
  expect(initial.user?.nickname).toBe('orion')
  expect(initial.authenticatedName).toBe('Orion')
  expect(initial.authenticatedRole).toBe('admin')
  ok('alice') // The system admin must not prevent first-human bootstrap.
  expect(state('alice').user?.role).toBe('admin')
  configure('orion', 'member')
  const reduced = state('orion')
  expect(reduced.authenticatedRole).toBe('member')
  expect(reduced.tokenHash).toBe(initial.tokenHash)
  configure('renamed')
  expect(token('renamed').status).toBe(1)
  configure('orion', 'member')
  expect(state('orion').tokenHash).toBe(initial.tokenHash)
}), 60_000)

test('legacy adoption requires the existing identity and preserves its token and member role', () => fixture(({ token, ok, state, configure, removeIdentityConfig }) => {
  configure('orion', 'member')
  expect(token('orion').status).toBe(0)
  ok('alice')
  const old = state('orion')
  removeIdentityConfig()
  expect(token('nova').stderr).toContain('explicitly configure')
  configure('wrong')
  expect(token('wrong').stderr).toContain('configured agent does not exist')
  // A refused choice must not bind an identity lock that would prevent repairing the config.
  configure('orion', 'member')
  ok('bob', '--create')
  expect(state('orion').tokenHash).toBe(old.tokenHash)
  expect(state('orion').authenticatedRole).toBe('member')
  expect(state('wrong').user).toBeNull()
}), 60_000)

test('local overrides customize the principal and cannot bypass its identity lock', () => fixture(({ token, state, configure, configureLocal }) => {
  configure('orion', 'member')
  configureLocal({ name: 'Local Orion' })
  expect(token('orion').status).toBe(0)
  expect(state('orion').authenticatedRole).toBe('member')
  configureLocal({ id: 'other' })
  expect(token('other').stderr).toContain('agent.id changed')
}), 60_000)

test('explicit creation on an empty Box still bootstraps an admin; later admin creation is explicit', () => fixture(({ ok, state }) => {
  ok('alice', '--create')
  expect(state('alice').user?.role).toBe('admin')
  ok('carol', '--create', '--admin')
  expect(state('carol').user?.role).toBe('admin')
}), 60_000)

test('create refuses existing active or revoked identities without profile, role or token changes', () => fixture(({ token, ok, state }) => {
  ok('alice')
  ok('bob', '--create', '--name', 'Bob Original')
  const before = state('bob')
  expect(token('bob', '--create', '--admin', '--rotate', '--name', 'Overwritten').status).toBe(1)
  expect(state('bob')).toEqual(before)
  const revoked = state('bob', true)
  expect(token('bob', '--create', '--admin').status).toBe(1)
  expect(state('bob')).toEqual(revoked)
  expect(token('invalid', '--create', '--name').status).toBe(1)
  expect(state('invalid').user).toBeNull()
}), 60_000)
