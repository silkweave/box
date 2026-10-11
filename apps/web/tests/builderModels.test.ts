import { expect, test } from 'bun:test'
import type { ModelOption } from '@workerdeck/protocol'
import { builderModelOptions } from '../src/lib/builderModels.ts'

const option = (value: string, resolvedModel?: string): ModelOption => ({ value, resolvedModel, displayName: value })

const claude = [
  option('claude-fable-5-1[1m]', 'claude-fable-5-1'),
  option('claude-fable-5[1m]', 'claude-fable-5'),
  option('opus[1m]', 'claude-opus-5-5[1m]'),
  option('claude-opus-5[1m]', 'claude-opus-5'),
  option('sonnet', 'claude-sonnet-5-5'),
  option('haiku', 'claude-haiku-4-5-20251001'),
]
const codex = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2'].map(id => option(id))

test('the status bar offers only the current generation, default first', () => {
  expect(builderModelOptions('claude', claude, 'claude-sonnet-5-5').map(m => m.value)).toEqual(['opus[1m]', 'sonnet', 'claude-fable-5-1[1m]'])
  expect(builderModelOptions('codex', codex, 'gpt-5.6-luna').map(m => m.value)).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'])
})

test('a session already on an older model keeps it visible', () => {
  expect(builderModelOptions('codex', codex, 'gpt-5.5').map(m => m.value)).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra', 'gpt-5.5'])
  expect(builderModelOptions('claude', claude, 'claude-opus-5-5').map(m => m.value)).toHaveLength(3)
})

test('an unknown engine keeps the worker catalogue', () => {
  expect(builderModelOptions(undefined, codex, undefined)).toHaveLength(codex.length)
})
