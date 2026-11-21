import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askable,
  clipInstructions,
  draftBody,
  instructions,
  INSTRUCTIONS_EVENT,
  MAX_INSTRUCTIONS_CHARS,
  setInstructions,
  draftGuesses,
  followedUpKeys,
  followUpId,
  guesses,
  isTransient,
  repliesBody,
  settledReply,
  turnAnswer,
  turnBody
} from '../src/renderer/src/state/predictive'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

describe('predictive replies', () => {
  it('keeps guesses best first, drops blank, long and repeated ones', () => {
    const long = 'x'.repeat(201)
    const answer = {
      replies: [
        { text: 'Sounds good', p: 0.4 },
        { text: '  Thanks!  ', p: 0.9 },
        { text: 'thanks!', p: 0.8 },
        { text: '', p: 1 },
        { text: long, p: 1 },
        { text: 'Tell me more' },
        'not an object'
      ]
    }
    expect(guesses(answer)).toEqual(['Thanks!', 'Tell me more', 'Sounds good'])
    expect(guesses(null)).toEqual([])
  })

  it('asks for a clamped count', () => {
    expect(repliesBody('s1', 9, 'English', 'fast')).toEqual({ session_id: 's1', kind: 'replies', count: 5, language: 'English', model: 'fast', wait_s: 20 })
  })

  it('keys only a settled reply', () => {
    const user: TranscriptItem = { kind: 'user', key: 'u', text: 'hi' } as TranscriptItem
    const reply: TranscriptItem = { kind: 'assistant', key: 'a', text: 'Hello there', streaming: false }
    expect(settledReply([user, reply], false)).toBe('1:11:Hello there')
    expect(settledReply([user, reply], true)).toBeNull()
    expect(settledReply([user, { ...reply, streaming: true } as TranscriptItem], false)).toBeNull()
    expect(settledReply([reply, user], false)).toBeNull()
    expect(settledReply([user, { kind: 'notice', key: 'n', text: 'x', tone: 'error' }], false)).toBeNull()
  })
})

describe('predictive draft guesses', () => {
  it('keeps a continuation’s leading space and drops long or repeated ones', () => {
    const answer = {
      next: [{ text: ' the  weather' }, { text: 'ing' }, { text: ' the weather' }, { text: ' ' + 'x'.repeat(70) }, { text: '  ' }],
      replies: [{ text: 'What is the weather?', p: 1 }]
    }
    expect(draftGuesses(answer)).toEqual({ next: [' the weather', 'ing'], replies: ['What is the weather?'] })
  })

  it('asks only about a draft that fits', () => {
    expect(askable('hi')).toBe(false)
    expect(askable('  a  ')).toBe(false)
    expect(askable('hey')).toBe(true)
    expect(askable('😀'.repeat(2000))).toBe(true)
    expect(askable('😀'.repeat(2001))).toBe(false)
  })

  it('asks with the draft and a short wait', () => {
    expect(draftBody('s', 'what is', 3, 'English', 'chat')).toEqual({
      session_id: 's',
      kind: 'draft',
      draft: 'what is',
      count: 3,
      language: 'English',
      model: 'chat',
      wait_s: 4
    })
  })
})

describe('Hermes follows up', () => {
  it('sends the turn facts rounded and clamped', () => {
    const body = turnBody('s1', { lastReplyS: 61.6, onScreenS: -3, check: 9, localTime: 'Thursday 14:05' }, 'en', 'fast')
    expect(body).toEqual({
      session_id: 's1',
      kind: 'turn',
      count: 1,
      language: 'en',
      model: 'fast',
      wait_s: 30,
      facts: { last_reply_s: 62, on_screen_s: 0, check: 4, max_checks: 4, local_time: 'Thursday 14:05' }
    })
    expect(turnBody('s1', { lastReplyS: 1, onScreenS: 1, check: 0 }, 'en', 'chat').facts).not.toHaveProperty('local_time')
  })

  it('takes a turn only with a nudge, and clamps when to ask again', () => {
    expect(turnAnswer({ take_turn: true, nudge: 'Check the build', ask_again_in_seconds: 5 })).toEqual({
      takeTurn: true,
      nudge: 'Check the build',
      askAgain: 30
    })
    expect(turnAnswer({ take_turn: true, nudge: '  ' }).takeTurn).toBe(false)
    expect(turnAnswer({ take_turn: false, ask_again_in_seconds: 5000 })).toEqual({ takeTurn: false, nudge: null, askAgain: 900 })
    expect(turnAnswer(null)).toEqual({ takeTurn: false, nudge: null, askAgain: null })
  })

  it('retries only errors that may pass', () => {
    expect(isTransient(new Error('HTTP 503'))).toBe(true)
    expect(isTransient(new Error('HTTP 429'))).toBe(true)
    expect(isTransient(new Error('HTTP 501'))).toBe(false)
    expect(isTransient(new Error('HTTP 404'))).toBe(false)
    expect(isTransient(new Error('The model took too long'))).toBe(true)
    expect(isTransient(new Error('Unknown kind'))).toBe(false)
  })
})

describe('followed-up tags', () => {
  it('tags the last of replies alike under the same message', () => {
    const items = [
      { kind: 'user', key: 'u1', text: 'hi' },
      { kind: 'assistant', key: 'a1', text: 'Hello', streaming: false },
      { kind: 'assistant', key: 'a2', text: 'Hello ', streaming: false },
      { kind: 'user', key: 'u2', text: 'more' },
      { kind: 'assistant', key: 'a3', text: 'Hello', streaming: false }
    ] as unknown as TranscriptItem[]
    expect([...followedUpKeys(items, new Set([followUpId(1, 'Hello')]))]).toEqual(['a2'])
    expect(followedUpKeys(items, undefined).size).toBe(0)
  })
})

describe('predictive instructions (hermes-conduit#2970)', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubStorage() {
    const store = new Map<string, string>()
    const events: string[] = []
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent) => void events.push(`${e.type}:${e.detail}`) })
    return events
  }

  it('sends each kind only its own instructions, and nothing when blank', () => {
    const events = stubStorage()
    setInstructions('replies', '  Favor next steps.\n')
    setInstructions('draft', ' \n ')
    setInstructions('turn', 'Only for results.')
    expect(events).toEqual([`${INSTRUCTIONS_EVENT}:replies`, `${INSTRUCTIONS_EVENT}:draft`, `${INSTRUCTIONS_EVENT}:turn`])
    expect(instructions('replies')).toBe('Favor next steps.')
    expect(instructions('draft')).toBeNull()
    expect(repliesBody('s1', 3, 'English', 'fast', instructions('replies'))).toMatchObject({ custom_instructions: 'Favor next steps.' })
    expect(draftBody('s1', 'Can you', 3, 'English', 'fast', instructions('draft'))).not.toHaveProperty('custom_instructions')
    expect(turnBody('s1', { lastReplyS: 1, onScreenS: 1, check: 1 }, 'English', 'fast', instructions('turn'))).toMatchObject({
      kind: 'turn',
      custom_instructions: 'Only for results.'
    })
    expect(repliesBody('s1', 3, 'English', 'fast')).not.toHaveProperty('custom_instructions')
  })

  it('cuts instructions at the plugin limit at a whole character', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' // one character, five code points
    const fits = 'a'.repeat(MAX_INSTRUCTIONS_CHARS)
    expect(clipInstructions(fits)).toBe(fits)
    const clipped = clipInstructions('a'.repeat(MAX_INSTRUCTIONS_CHARS - 2) + family)
    expect(clipped).toBe('a'.repeat(MAX_INSTRUCTIONS_CHARS - 2))
  })
})
