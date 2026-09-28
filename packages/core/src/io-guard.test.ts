// Under Vitest the live instance is out of reach: a test that has not redirected (or a second copy
// of core that never saw the redirect) must fail loudly instead of writing the real data/.
import { expect, it } from 'vitest'
import { configRoot, instanceDir, repoRoot, resetInstanceDir, setInstanceDir } from './io.js'

it('refuses the live instance directory under Vitest, but not the checkout configuration', () => {
  const redirected = instanceDir()
  try {
    resetInstanceDir()
    expect(() => instanceDir()).toThrow(/Refusing to use the live Box instance/)
    expect(configRoot()).toBe(repoRoot())
  } finally {
    setInstanceDir(redirected)
  }
})
