import { describe, expect, it } from 'vitest'
import { splitKeys } from '../prompt.js'

describe('prompt keys', () => {
  it('splits a burst of keys into arrows and single characters', () => {
    expect(splitKeys('\u001b[B\u001b[B\u001bOA2\r')).toEqual(['\u001b[B', '\u001b[B', '\u001bOA', '2', '\r'])
    expect(splitKeys('?')).toEqual(['?'])
  })
})
