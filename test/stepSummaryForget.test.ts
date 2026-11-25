import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSummaries, saveSummary, savedSummary, summaryScope } from '../src/renderer/src/state/stepSummaries'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0
} as Storage

describe('step summaries by host', () => {
  beforeEach(() => store.clear())

  it('keeps each host and profile apart', () => {
    saveSummary(summaryScope('https://one', undefined), 'call_aaaaaaaaaaaa', 'One')
    expect(savedSummary(summaryScope('https://one', 'default'), 'call_aaaaaaaaaaaa')).toBe('One')
    expect(savedSummary(summaryScope('https://two', undefined), 'call_aaaaaaaaaaaa')).toBeNull()
    expect(savedSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa')).toBeNull()
  })

  it("forgets a signed-out host's summaries and those kept before hosts scoped them", () => {
    saveSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa', 'One')
    saveSummary(summaryScope('https://two', undefined), 'call_bbbbbbbbbbbb', 'Two')
    saveSummary('default', 'call_cccccccccccc', 'Old')
    forgetSummaries(['https://two'])
    expect(savedSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa')).toBeNull()
    expect(savedSummary(summaryScope('https://two', 'default'), 'call_bbbbbbbbbbbb')).toBe('Two')
    expect(savedSummary('default', 'call_cccccccccccc')).toBeNull()
    forgetSummaries([])
    expect(store.size).toBe(0)
  })
})

describe('telling a step summary question', () => {
  it('knows the last-run and explain questions in any language and length, and nothing else', async () => {
    const { question, explainQuestion, isQuestion } = await import('../src/renderer/src/state/stepSummaries')
    expect(isQuestion(question('German', 27))).toBe(true)
    const steps = [
      { kind: 'tool', key: 't', toolId: 'call_aaaaaaaaaaaa', name: 'terminal', args: 'ls, tell the user, looking back', result: 'ok', status: 'done' }
    ]
    expect(isQuestion(explainQuestion('English', 36, steps as never))).toBe(true)
    expect(isQuestion(question('German', 27) + ' and more')).toBe(false)
    expect(isQuestion('What did you just do?')).toBe(false)
    expect(isQuestion(null)).toBe(false)
    expect(
      isQuestion(
        'Describe in one short sentence (at most 15 words) what you did in the tool calls just before your last reply. ' +
          "It labels those steps, folded, in the user's chat app. " +
          'Write it in French, in the past tense, like "Searched three sites and compared their prices". ' +
          'Reply with the sentence only.'
      )
    ).toBe(true)
  })
})

describe('reading saved summaries (desktop#541)', () => {
  it('parses the store once while its text stays the same, and again after a write', () => {
    store.clear()
    saveSummary(summaryScope('h', 'default'), 'call_aaaaaaaaaaaa', 'Read the logs')
    const parse = vi.spyOn(JSON, 'parse')
    try {
      for (let i = 0; i < 5; i++) expect(savedSummary(summaryScope('h', 'default'), 'call_aaaaaaaaaaaa')).toBe('Read the logs')
      expect(savedSummary(summaryScope('h', 'default'), 'call_other')).toBeNull()
      expect(parse.mock.calls.length).toBeLessThanOrEqual(1)
      store.set('conduit.stepRunSummaries', JSON.stringify([[summaryScope('h', 'default'), 'call_aaaaaaaaaaaa', 'Another window wrote']]))
      expect(savedSummary(summaryScope('h', 'default'), 'call_aaaaaaaaaaaa')).toBe('Another window wrote')
    } finally {
      parse.mockRestore()
    }
  })
})
