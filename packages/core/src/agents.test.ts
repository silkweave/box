// Agent files (`data/config/agents/<id>.md`): the parser, the accessors and the eligibility
// predicate. Pure file reads against a throwaway instance; the users-table side is in
// auth/agents-lifecycle.test.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AgentFileError, agentConfig, agentFileProblems, agentInstructions, agentRowProblem, agentsDir, configuredAgents, isConfiguredAgent, parseAgentFile } from './agents.js'
import { resetInstanceDir, setInstanceDir } from './testing.js'

let dir: string

const write = (id: string, text: string): void => {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), `${id}.md`), text)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-agents-'))
  setInstanceDir(dir)
})

afterEach(() => {
  rmSync(agentsDir(), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('parseAgentFile', () => {
  it('reads name, role and the body as instructions', () => {
    expect(parseAgentFile('stella', '---\nname: Stella\nrole: member\n---\nYou are Stella.\n\nResearch.\n', { system: false })).toEqual({
      name: 'Stella',
      role: 'member',
      instructions: 'You are Stella.\n\nResearch.',
    })
  })

  it('accepts quoted values, CRLF and an empty body', () => {
    expect(parseAgentFile('ops', '---\r\nname: "Head of Ops"\r\nrole: \'admin\'\r\n---\r\n', { system: false })).toEqual({
      name: 'Head of Ops',
      role: 'admin',
      instructions: '',
    })
  })

  it('refuses unknown keys, naming the key', () => {
    expect(() => parseAgentFile('x', '---\nname: X\nrole: member\nengine: codex\n---\n', { system: false })).toThrow(/unknown key "engine"/)
  })

  it('refuses a missing name, a bad role, a missing block and an unclosed block', () => {
    expect(() => parseAgentFile('x', '---\nrole: member\n---\n', { system: false })).toThrow(/name is required/)
    expect(() => parseAgentFile('x', '---\nname: X\nrole: owner\n---\n', { system: false })).toThrow(/role is required/)
    expect(() => parseAgentFile('x', 'just instructions', { system: false })).toThrow(/needs front matter/)
    expect(() => parseAgentFile('x', '---\nname: X\nrole: member\n', { system: false })).toThrow(/not closed/)
    expect(() => parseAgentFile('x', '---\nname X\n---\n', { system: false })).toThrow(/not "key: value"/)
    expect(() => parseAgentFile('x', '---\nname: X\nname: Y\nrole: member\n---\n', { system: false })).toThrow(/appears twice/)
  })

  it('refuses a file name that is not a slug', () => {
    expect(() => parseAgentFile('Stella', '---\nname: S\nrole: member\n---\n', { system: false })).toThrow(AgentFileError)
  })

  it('lets the system principal file hold instructions only', () => {
    expect(parseAgentFile('nova', 'Be brief.', { system: true })).toEqual({ instructions: 'Be brief.' })
    expect(parseAgentFile('nova', '---\n---\nBe brief.', { system: true })).toEqual({ instructions: 'Be brief.' })
    expect(() => parseAgentFile('nova', '---\nname: Nova\n---\n', { system: true })).toThrow(/come from box.json/)
    expect(() => parseAgentFile('nova', '---\nrole: member\n---\n', { system: true })).toThrow(/come from box.json/)
  })
})

describe('accessors', () => {
  it('lists the system principal first, then the files by id, read at call time', () => {
    expect(configuredAgents().map((a) => a.id)).toEqual(['nova'])
    write('zed', '---\nname: Zed\nrole: member\n---\n')
    write('stella', '---\nname: Stella\nrole: admin\n---\nHi.')
    writeFileSync(join(agentsDir(), 'notes.txt'), 'ignored')
    expect(configuredAgents().map((a) => [a.id, a.name, a.role, a.system])).toEqual([
      ['nova', 'Nova', 'admin', true],
      ['stella', 'Stella', 'admin', false],
      ['zed', 'Zed', 'member', false],
    ])
    expect(agentInstructions('stella')).toBe('Hi.')
    expect(isConfiguredAgent('zed')).toBe(true)
    rmSync(join(agentsDir(), 'zed.md'))
    expect(agentConfig('zed')).toBeNull()
    expect(isConfiguredAgent('zed')).toBe(false)
  })

  it('gives the system principal its box.json identity and its file instructions', () => {
    write('nova', 'Answer in English.')
    expect(agentConfig('nova')).toMatchObject({ id: 'nova', name: 'Nova', role: 'admin', instructions: 'Answer in English.', system: true })
  })

  it('reports every invalid file without throwing', () => {
    write('good', '---\nname: Good\nrole: member\n---\n')
    write('bad', '---\nname: Bad\nrole: member\ncolor: red\n---\n')
    write('nova', '---\nname: Other\n---\n')
    const problems = agentFileProblems()
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/bad\.md: unknown key "color"/)
    expect(problems.join('\n')).toMatch(/nova\.md: the system principal's name/)
    expect(() => configuredAgents()).toThrow(AgentFileError)
  })
})

describe('agentRowProblem (the eligibility predicate)', () => {
  it('does not judge a human row', () => {
    expect(agentRowProblem({ id: 'alice', kind: 'human', status: 'active' })).toBeNull()
    expect(agentRowProblem({ id: 'alice', kind: null, status: 'active' })).toBeNull()
  })

  it('needs an agent row to be unrevoked AND its file to exist and parse', () => {
    write('stella', '---\nname: Stella\nrole: member\n---\n')
    expect(agentRowProblem({ id: 'stella', kind: 'agent', status: 'active' })).toBeNull()
    expect(agentRowProblem({ id: 'stella', kind: 'agent', status: 'revoked' })).toMatch(/retired/)
    expect(agentRowProblem({ id: 'stella', kind: 'agent', status: 'active', token_revoked_at: '2026-10-11 00:00:00' })).toMatch(/retired/)
    write('stella', '---\nname: Stella\nrole: boss\n---\n')
    expect(agentRowProblem({ id: 'stella', kind: 'agent', status: 'active' })).toMatch(/inactive/)
    rmSync(join(agentsDir(), 'stella.md'))
    expect(agentRowProblem({ id: 'stella', kind: 'agent', status: 'active' })).toMatch(/does not exist/)
  })

  it('judges the system principal by its row only (box.json is always there)', () => {
    write('nova', '---\nname: Broken\n---\n')
    expect(agentRowProblem({ id: 'nova', kind: 'agent', status: 'active' })).toBeNull()
    expect(agentRowProblem({ id: 'nova', kind: 'agent', status: 'revoked' })).toMatch(/retired/)
  })
})
