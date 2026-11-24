import { beforeEach, describe, expect, it } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import { answering, askedInOf, clearExpired, dropExpiredAsking, expiredFor, markExpired, noteChatSession, noteLocked, noteRequests, resetExpiredQuestions, takeCancel } from '../src/renderer/src/state/expiredQuestions'
import { insertQuote } from '../src/renderer/src/state/quote'

const ask = (id: string, sessionId = 's1'): PendingRequest => ({
  id,
  method: 'clarify',
  sessionId,
  params: { questions: [{ id: 'q1', question: 'Run the fix?', choices: ['Yes', 'No'] }] },
  receivedAt: 1
})

describe('questions Hermes stopped waiting for (issue 2850)', () => {
  beforeEach(resetExpiredQuestions)

  it('keeps a question whose wait timed out or whose turn stopped', () => {
    noteRequests([ask('a'), ask('b')])
    takeCancel({ id: 'a', method: 'clarify', reason: 'timeout' })
    takeCancel({ id: 'b', method: 'clarify', reason: 'interrupted' })
    expect(expiredFor('s1').map(e => e.request.id)).toEqual(['a', 'b'])
  })

  it('lets one answered on another device go', () => {
    noteRequests([ask('a')])
    takeCancel({ id: 'a', method: 'clarify', reason: 'resolved' })
    takeCancel({ id: 'a', method: 'clarify', reason: 'timeout' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('lets one the person wrote past go: their message took its place', () => {
    noteRequests([ask('a')])
    takeCancel({ id: 'a', method: 'clarify', reason: 'superseded' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('lets one go once the person dismisses it in the Work panel', () => {
    markExpired(ask('a'))
    markExpired({ ...ask('b', 's2'), params: { questions: [{ id: 'q1', question: 'Keep going?' }] } })
    dropExpiredAsking('  Run the fix? ')
    expect(expiredFor('s1')).toEqual([])
    expect(expiredFor('s2')).toHaveLength(1)
  })

  it('ignores approvals and requests it never showed', () => {
    noteRequests([{ ...ask('a'), method: 'approval' }])
    takeCancel({ id: 'a', reason: 'timeout' })
    takeCancel({ id: 'zz', reason: 'timeout' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('carries the answers locked here, and stays with its own chat until a message is sent there', () => {
    noteRequests([ask('a'), ask('b', 's2')])
    noteLocked('a', 'q1', 'Yes')
    takeCancel({ id: 'a', reason: 'timeout' })
    markExpired(ask('b', 's2'))
    expect(expiredFor('s1')[0]!.locked).toEqual({ q1: 'Yes' })
    clearExpired('s1')
    expect(expiredFor('s1')).toEqual([])
    expect(expiredFor('s2')).toHaveLength(1)
  })

  it('puts the question in the draft as a quote with the choice under it', () => {
    expect(answering('Run the fix?\nOne more cycle.', ' Yes, run it ')).toBe('> Run the fix?\n> One more cycle.\n\nYes, run it')
    expect(answering('Which branch?', null)).toBe('> Which branch?')
    expect(answering('Which branch?', '  ')).toBe('> Which branch?')
    expect(answering(' \n', 'Yes')).toBe('')
    expect(insertQuote(answering('Run it?', 'Yes'), 'Draft')).toBe('Draft\n\n> Run it?\n\nYes\n\n')
  })
})

describe('a dismissed question leaves its own chat and its own question only (#376)', () => {
  beforeEach(resetExpiredQuestions)
  const batch = (id: string, sessionId: string): PendingRequest => ({
    id,
    method: 'clarify',
    sessionId,
    params: { questions: [{ question: 'Run the fix?', choices: ['Yes', 'No'] }, { question: 'Which branch?' }] },
    receivedAt: 1
  })

  it('keeps the same words kept in another chat', () => {
    markExpired(ask('a', 's1'))
    markExpired(ask('b', 's2'))
    dropExpiredAsking('Run the fix?', { live: 's1' })
    expect(expiredFor('s1')).toEqual([])
    expect(expiredFor('s2')).toHaveLength(1)
    // A question of some other chat, dismissed in the Work panel beside s2: s2's card stays.
    markExpired(ask('c', 's3'))
    dropExpiredAsking('Run the fix?', { notLive: 's2' })
    expect(expiredFor('s2')).toHaveLength(1)
    expect(expiredFor('s3')).toEqual([])
  })

  it('dismisses only the asking chat when its stored id maps to a live session (issue 464)', () => {
    markExpired(ask('a', 's1'))
    markExpired(ask('b', 's2'))
    markExpired(ask('c', 's3'))
    noteChatSession('stored-c', 's3')
    // The Work panel beside s2 dismisses a question asked in stored-c; s1 is a third chat.
    dropExpiredAsking('Run the fix?', { notLive: 's2', stored: 'stored-c' })
    expect(expiredFor('s3')).toEqual([])
    expect(expiredFor('s1')).toHaveLength(1)
    expect(expiredFor('s2')).toHaveLength(1)
  })

  it("takes one question off a batch's card and the card once none is left", () => {
    markExpired(batch('a', 's1'))
    dropExpiredAsking('Run the fix?', { live: 's1' })
    expect(expiredFor('s1')).toHaveLength(1)
    expect(expiredFor('s1')[0]!.dismissed).toEqual(['Run the fix?'])
    // Dismissing it again changes nothing.
    const kept = expiredFor('s1')[0]
    dropExpiredAsking('Run the fix?', { live: 's1' })
    expect(expiredFor('s1')[0]).toBe(kept)
    dropExpiredAsking('Which branch?', { live: 's1' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('stays gone when the wait ends after the dismissal', () => {
    // The card still waits here (a replay after a reconnect): its cancel lands after the dismissal.
    noteRequests([ask('a', 's1'), batch('b', 's1'), ask('c', 's2')])
    dropExpiredAsking('Run the fix?', { live: 's1' })
    takeCancel({ id: 'a', reason: 'timeout' })
    takeCancel({ id: 'b', reason: 'timeout' })
    takeCancel({ id: 'c', reason: 'timeout' })
    // a had only that question; b keeps its other one; c is another chat's.
    expect(expiredFor('s1').map(e => [e.request.id, e.dismissed])).toEqual([['b', ['Run the fix?']]])
    expect(expiredFor('s2').map(e => e.request.id)).toEqual(['c'])
    // The same words asked again later are a new question.
    markExpired(ask('d', 's1'))
    expect(expiredFor('s1').map(e => e.request.id)).toEqual(['b', 'd'])
  })

  it('reads where a Work panel question was asked against the chat on screen', () => {
    expect(askedInOf('c1', { storedId: 'c1', liveId: 'L' })).toEqual({ live: 'L', stored: 'c1' })
    expect(askedInOf('c2', { storedId: 'c1', liveId: 'L' })).toEqual({ notLive: 'L', stored: 'c2' })
    // "" is the Bot Chat.
    expect(askedInOf('', { storedId: 'c1', liveId: 'L', botChat: true })).toEqual({ live: 'L', stored: '' })
    expect(askedInOf('', { storedId: 'c1', liveId: 'L' })).toEqual({ notLive: 'L', stored: '' })
    // No live chat on screen: the wording decides, as before.
    expect(askedInOf('c1', { storedId: 'c1' })).toBeUndefined()
    expect(askedInOf('c1')).toBeUndefined()
  })
})
