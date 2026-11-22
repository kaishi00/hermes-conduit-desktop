import { describe, expect, it } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import {
  approvalView,
  clarifyQuestions,
  lockedAnswers,
  requestSummary,
  askedInChat,
  askedQuestionsBlock,
  unmatchedWaiting,
  waitingFromResponse,
  waitingPath
} from '../src/renderer/src/state/needsYou'

const request = (over: Partial<PendingRequest>): PendingRequest => ({ id: 'r', method: 'approval', sessionId: 's', params: {}, receivedAt: 0, ...over })

describe('approvals', () => {
  it('labels the choices Hermes offers, in its order', () => {
    const view = approvalView({ description: 'Delete build', command: 'rm -rf build', choices: ['once', 'session', 'always', 'deny'] })
    expect(view.description).toBe('Delete build')
    expect(view.command).toBe('rm -rf build')
    expect(view.choices.map(c => [c.choice, c.label, c.tone])).toEqual([
      ['once', 'Allow once', 'primary'],
      ['session', 'Allow for this chat', 'plain'],
      ['always', 'Always allow', 'plain'],
      ['deny', 'Deny', 'danger']
    ])
  })

  it('falls back to once or deny, and a plain description', () => {
    const view = approvalView({})
    expect(view.choices.map(c => c.choice)).toEqual(['once', 'deny'])
    expect(view.description).toBe('Hermes wants to run a command.')
    expect(view.command).toBeUndefined()
  })
})

describe('questions', () => {
  it('reads a batch and what it already locked', () => {
    const params = {
      questions: [
        { qid: 'q1', question: 'Which color?', choices: ['Red', 'Blue', ''], multi_select: false },
        { qid: 'q2', question: 'Toppings?', choices: ['Cheese', 'Ham'], multi_select: true },
        { qid: 'q3', question: '' }
      ],
      answers: { q1: 'Red', q2: null }
    }
    expect(clarifyQuestions(params)).toEqual([
      { qid: 'q1', question: 'Which color?', choices: ['Red', 'Blue'], multiSelect: false },
      { qid: 'q2', question: 'Toppings?', choices: ['Cheese', 'Ham'], multiSelect: true }
    ])
    expect(lockedAnswers(params)).toEqual({ q1: 'Red', q2: null })
  })

  it('summarizes a batch by its first question', () => {
    expect(requestSummary(request({ method: 'clarify', params: { questions: [{ qid: 'a', question: 'One?' }, { qid: 'b', question: 'Two?' }] } }))).toBe('One? (+1 more)')
    expect(requestSummary(request({ params: { description: 'Run tests' } }))).toBe('Run tests')
  })
})

describe('the waiting list', () => {
  it('reads the plugin’s rows, with seconds as milliseconds', () => {
    const rows = waitingFromResponse(
      { ok: true, waiting: [{ id: 'w1', kind: 'question', session_ids: ['stored-1', 'live-1'], title: 'Trip [Recent voice conv', summary: 'Which day?', questions: 2, at: 1_763_000_000 }, { id: 'bad' }] },
      'work'
    )
    expect(rows).toEqual([
      { id: 'w1', kind: 'question', sessionIds: ['stored-1', 'live-1'], title: 'Trip', summary: 'Which day?', questions: 2, at: 1_763_000_000_000, profile: 'work' }
    ])
  })

  it('keeps the hosted room a wait is in, so its row opens the room', () => {
    const rows = waitingFromResponse({ waiting: [{ id: 'w2', kind: 'approval', session_ids: ['s9'], title: 'Launch', room: ' room-7 ' }, { id: 'w3', kind: 'approval', session_ids: ['s8'], room: '' }] })
    expect(rows.map(r => r.roomId)).toEqual(['room-7', undefined])
  })

  it('lists a question that waits past its turn as a row that opens the chat that asked', () => {
    const rows = waitingFromResponse(
      {
        waiting: [],
        questions: [
          { id: 'P7', kind: 'proposal', status: 'open', text: 'Roll back the deploy?', at: 1_763_000_000, chat: 's4', session_ids: ['s4'], chat_title: 'Deploys' },
          { id: 'P8', kind: 'proposal', status: 'open', text: 'No chat to open', at: 1, session_ids: [] }
        ]
      },
      'work'
    )
    expect(rows).toEqual([
      {
        id: 'asked-work-P7-s4',
        kind: 'question',
        sessionIds: ['s4'],
        title: 'Deploys',
        summary: 'Roll back the deploy?',
        questions: 1,
        at: 1_763_000_000_000,
        profile: 'work',
        question: expect.objectContaining({ id: 'P7', text: 'Roll back the deploy?', chat: 's4' })
      }
    ])
  })

  it('draws the questions waiting past their turn in the chat that asked, oldest first', () => {
    const body = {
      questions: [
        { id: 'P9', kind: 'proposal', status: 'open', text: 'Newer', at: 3, session_ids: ['s4'], choices: ['A', 'B'], recommended: 'B', actions: ['answer'] },
        { id: 'P7', kind: 'proposal', status: 'open', text: 'Older', at: 1, session_ids: ['s4'], actions: ['approve', 'decline'] },
        { id: 'P8', kind: 'proposal', status: 'open', text: 'Elsewhere', at: 2, session_ids: ['s5'] }
      ]
    }
    const rows = [...waitingFromResponse(body, 'work'), ...waitingFromResponse(body)]
    const here = askedInChat(rows, 'work', ['s4', null])
    expect(here.map(r => r.question?.id)).toEqual(['P7', 'P9'])
    expect(here[1].question).toMatchObject({ choices: ['A', 'B'], recommended: 'B' })
    // The default profile's chat, named either way, takes only its own.
    expect(askedInChat(rows, 'default', ['s5']).map(r => r.id)).toEqual(['asked--P8-s5'])
    expect(askedInChat(rows, undefined, ['nothing'])).toEqual([])
  })

  it('keeps a question that waits past its turn listed while its chat holds a live request', () => {
    const rows = waitingFromResponse({ questions: [{ id: 'P7', status: 'open', at: 1, session_ids: ['live-1'] }] })
    expect(unmatchedWaiting(rows, [request({ sessionId: 'live-1' })]).map(r => r.id)).toEqual(['asked--P7-live-1'])
  })

  it('asks per profile', () => {
    expect(waitingPath()).toBe('/api/plugins/conduit_push/waiting')
    expect(waitingPath('my bot')).toBe('/api/plugins/conduit_push/waiting?profile=my%20bot')
  })

  it('lists a wait once when a live request already shows it', () => {
    const rows = waitingFromResponse({ waiting: [{ id: 'w1', kind: 'approval', session_ids: ['stored-1', 'live-1'], at: 1 }, { id: 'w2', kind: 'approval', session_ids: ['stored-2'], at: 1 }] })
    expect(unmatchedWaiting(rows, [request({ sessionId: 'live-1' })]).map(r => r.id)).toEqual(['w2'])
  })

  it('tells a live call the questions waiting past their turn, oldest first, with their choices', () => {
    const rows = waitingFromResponse({
      questions: [
        { id: 'P9', kind: 'proposal', status: 'open', text: 'Tag it now?', at: 3, session_ids: ['s1'], actions: ['approve', 'decline'] },
        { id: 'P7', kind: 'proposal', status: 'open', text: 'Which branch?', at: 1, session_ids: ['s2'], choices: ['main', 'release/2.4'], recommended: 'release/2.4', actions: ['answer'] },
        { id: 'P8', kind: 'proposal', status: 'open', text: 'What should it be called?', at: 2, session_ids: ['s3'], actions: ['answer'] }
      ]
    })
    const block = askedQuestionsBlock(rows)
    expect(block).toContain('- P7: «Which branch?» Choices: «main», «release/2.4». Hermes recommends «release/2.4».')
    expect(block).toContain('- P9: «Tag it now?» A yes or no.')
    expect(block).toContain('- P8: «What should it be called?»\n')
    expect(block.indexOf('P7:')).toBeLessThan(block.indexOf('P8:'))
    expect(block.indexOf('P8:')).toBeLessThan(block.indexOf('P9:'))
    expect(block).toContain('My answer to P7')
    expect(askedQuestionsBlock([])).toBe('')
  })

  it('puts a question with no time last, and calls one a yes or no only when its card offers the pair', () => {
    const body = {
      questions: [
        { id: 'P5', kind: 'proposal', status: 'open', text: 'Untimed', session_ids: ['s4'], actions: ['approve'] },
        { id: 'P6', kind: 'proposal', status: 'open', text: 'Timed', at: 2, session_ids: ['s4'], actions: ['approve', 'decline'] }
      ]
    }
    const rows = waitingFromResponse(body, 'work')
    expect(askedInChat(rows, 'work', ['s4']).map(r => r.question?.id)).toEqual(['P6', 'P5'])
    const block = askedQuestionsBlock(rows)
    expect(block.indexOf('P6:')).toBeLessThan(block.indexOf('P5:'))
    expect(block).toContain('- P5: «Untimed»\n')
    expect(block).toContain('- P6: «Timed» A yes or no.')
  })
})
