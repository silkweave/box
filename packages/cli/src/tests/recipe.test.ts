import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecipeArgs } from '../recipe.ts'

test('box recipe arguments', () => {
  assert.deepEqual(parseRecipeArgs(['list']), { verb: 'list', json: false })
  assert.deepEqual(parseRecipeArgs(['list', '--json']), { verb: 'list', json: true })
  assert.deepEqual(parseRecipeArgs(['fetch', 'crm']), { verb: 'fetch', id: 'crm', quiet: false })
  const sha = 'a'.repeat(40)
  assert.deepEqual(parseRecipeArgs(['fetch', 'crm', '--version', sha, '-q']), { verb: 'fetch', id: 'crm', version: sha, quiet: true })
  assert.throws(() => parseRecipeArgs(['fetch']), /Name the recipe/)
  assert.throws(() => parseRecipeArgs(['fetch', 'crm', '--version', 'main']), /40-character/)
  assert.throws(() => parseRecipeArgs(['fetch', 'crm', 'chat']), /One recipe/)
  assert.throws(() => parseRecipeArgs(['adopt', 'crm']), /Expected/)
})
