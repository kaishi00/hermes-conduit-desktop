import { describe, expect, it } from 'vitest'
import { noteDashboardProfiles, setDashboardProfilesHost } from '../src/renderer/src/state/dashboardProfile'
import { doing, parseItem, parseWork, sections, sideWorkstreams, statusText, workPath, needsYou, sameWork, workTone, manageTitle, handOverCaption, workMenuItems, parseQuestions, questionButtons, questionHeadline, answerRequest, goingAheadText, answersInWords, canDismiss } from '../src/renderer/src/state/work'

const answer = {
  policy: 'on',
  counts: { working: 2, needs_you: 1, ready: 0 },
  resolved_count: 4,
  workstream_sessions: ['s1', 's2', 's9', 3],
  work: [
    {
      ref: 'W1',
      kind: 'workstream',
      status: 'running',
      title: 'Login bug',
      session_id: 's1',
      checklist: [
        { text: 'Read logs', state: 'done' },
        { text: 'Patch', state: 'doing' },
        { text: '', state: 'todo' }
      ],
      actions: ['send', 'stop', 'fly'],
      manage: ['pin'],
      updated_at: 100
    },
    { ref: 'W2', kind: 'workstream', status: 'needs_you', goal: 'Deploy', session_id: 's2', approval: { request_id: 'r1', command: 'rm -rf build', approvable: true } },
    { ref: 'W3', kind: 'workstream', status: 'done', title: 'Old', pinned: true },
    { ref: 'A1', kind: 'ask_out', status: 'waiting', bot: 'Nahida' },
    { ref: 'W4', kind: 'workstream', status: 'done', title: 'Older' },
    { ref: 'W1', kind: 'workstream', status: 'done' },
    { kind: 'workstream' }
  ]
}

describe('workstreams', () => {
  const snapshot = parseWork(answer)

  it('reads the rows once each, with only the actions it knows', () => {
    expect(snapshot.items.map(i => i.ref)).toEqual(['W1', 'W2', 'W3', 'A1', 'W4'])
    expect(snapshot.items[0]!.actions).toEqual(['send', 'stop'])
    expect(snapshot.items[0]!.checklist).toHaveLength(2)
    expect(snapshot.items[1]!.approval).toEqual({ requestId: 'r1', command: 'rm -rf build', description: '', approvable: true })
    expect(snapshot.sessionIds).toEqual(['s1', 's2', 's9'])
  })

  it('says what it is doing and where it stands', () => {
    expect(doing(snapshot.items[0]!)).toBe('Patch')
    expect(statusText(snapshot.items[1]!)).toBe('Needs you')
    expect(statusText(snapshot.items[3]!)).toBe('Waiting on Nahida')
    expect(needsYou(snapshot.items[1]!)).toBe(true)
  })

  it('lists pinned, then active with what needs you first, then recent', () => {
    const lists = sections(snapshot.items)
    expect(lists.pinned.map(i => i.ref)).toEqual(['W3'])
    expect(lists.active.map(i => i.ref)).toEqual(['W2', 'W1', 'A1'])
    expect(lists.recent.map(i => i.ref)).toEqual(['W4'])
  })

  it('names a secondary bot with conduit_profile', () => {
    // A plugin that reads ?conduit_profile=; until it answers, ?profile= goes.
    setDashboardProfilesHost('https://usage-test')
    noteDashboardProfiles('https://usage-test', ['dashboard-profiles'])
    expect(workPath('/x')).toBe('/x')
    expect(workPath('/x', 'default')).toBe('/x')
    expect(workPath('/x?resolved=1', 'nahida')).toBe('/x?resolved=1&conduit_profile=nahida')
  })
})

describe('a workstream on a model the bot named (app issue 2788)', () => {
  it('names the model and its reasoning, and nothing for the Workstream Model', () => {
    const named = parseItem({ ref: 'W1', kind: 'workstream', model: { model: 'claude-opus-5-5', provider: 'anthropic', reasoning_effort: 'xhigh' } })
    expect(named?.model).toBe('claude-opus-5-5 · xhigh')
    expect(parseItem({ ref: 'W2', kind: 'workstream', model: { model: 'gpt-5.5' } })?.model).toBe('gpt-5.5')
    expect(parseItem({ ref: 'W3', kind: 'workstream', model: null })?.model).toBe('')
    expect(parseItem({ ref: 'W4', kind: 'workstream' })?.model).toBe('')
  })

  it("lists the bots sidebar's workstreams: those with a chat, what needs you first", () => {
    expect(sideWorkstreams(parseWork(answer)).map(i => i.ref)).toEqual(['W2', 'W1'])
    expect(sideWorkstreams(null)).toEqual([])
  })
})

describe('a work read that says the same', () => {
  it('keeps the state', () => {
    const current = { sessions: new Set(['a', 'b']), byBot: new Map([['atlas', { working: 1, needsYou: 0 }]]) }
    expect(sameWork(current, new Set(['b', 'a']), new Map([['atlas', { working: 1, needsYou: 0 }]]))).toBe(true)
    expect(sameWork(current, new Set(['a']), new Map([['atlas', { working: 1, needsYou: 0 }]]))).toBe(false)
    expect(sameWork(current, new Set(['a', 'b']), new Map([['atlas', { working: 1, needsYou: 1 }]]))).toBe(false)
  })
})

describe('workTone', () => {
  it('gives each status its own colour', () => {
    const tone = (o: Record<string, unknown>) => workTone(parseItem({ ref: 'W9', kind: 'workstream', ...o })!)
    expect(tone({ status: 'needs_you', session_id: 's' })).toBe('needs')
    expect(tone({ status: 'interrupted' })).toBe('needs')
    expect(tone({ status: 'running' })).toBe('working')
    expect(tone({ status: 'starting' })).toBe('working')
    expect(tone({ status: 'ready' })).toBe('ready')
    expect(tone({ status: 'failed' })).toBe('failed')
    expect(tone({ status: 'done' })).toBe('done')
    expect(tone({ status: 'running', closed: true })).toBe('done')
    expect(tone({ status: 'waiting' })).toBe('working')
    expect(tone({ status: 'stopped' })).toBe('done')
    expect(workTone(parseItem({ ref: 'A1', kind: 'ask_out', status: 'waiting', bot: 'Nahida' })!)).toBe('working')
    expect(workTone(parseItem({ ref: 'A2', kind: 'ask_in', status: 'needs_you', bot: 'Nahida' })!)).toBe('needs')
    expect(workTone(parseItem({ ref: 'A3', kind: 'ask_out', status: 'answered' })!)).toBe('done')
  })
})

describe('the hand-off', () => {
  it('says who is kept out and what that means', () => {
    expect(manageTitle('leave_alone', 'Furina')).toBe('Keep Furina out of this')
    expect(manageTitle('coordinate', 'Furina')).toBe('Let Furina coordinate this')
    expect(handOverCaption('leave_alone', 'Furina')).toBe('Furina won’t message or stop it. You still can.')
    expect(handOverCaption('coordinate', 'Furina')).toBe('Furina can message or stop it again.')
  })
})

describe('questions that wait past their turn', () => {
  const card = (extra: Record<string, unknown>) => ({
    id: 'P7', kind: 'proposal', ref: 'W1', refs: ['W1', 'W2'], title: 'Login · Deploy', at: 100, text: 'Roll back the deploy?',
    status: 'open', answer: '', why: [], actions: ['approve', 'decline'], choices: [], recommended: '', going_ahead: false, chat: '', ...extra
  })

  it('reads the open ones from the coordination list, and nothing else there', () => {
    const snapshot = parseWork({
      ...answer,
      coordination: {
        mode: 'ask',
        items: [card({}), card({ id: 'P8', status: 'approved', actions: [] }), { id: 'E3', kind: 'flag', ref: 'W1' }, card({})]
      }
    })
    expect(snapshot.questions.map(q => q.id)).toEqual(['P7'])
    expect(snapshot.questions[0]).toMatchObject({ refs: ['W1', 'W2'], title: 'Login · Deploy', at: 100_000, chat: '' })
    expect(questionHeadline(snapshot.questions[0])).toBe('Asked you about W1, W2')
    expect(parseWork(answer).questions).toEqual([])
  })

  it('keeps a question time already in milliseconds', () => {
    expect(parseQuestions([card({ at: 1_700_000_000_000 })])[0].at).toBe(1_700_000_000_000)
    expect(parseQuestions([card({ at: 100 })])[0].at).toBe(100_000)
  })

  it('answers a yes-or-no question with Approve or Decline', () => {
    const question = parseQuestions([card({})])[0]
    expect(questionButtons(question).map(b => b.label)).toEqual(['Approve', 'Decline'])
    expect(answerRequest({ kind: 'decline' })).toEqual({ action: 'decline', body: {} })
    expect(goingAheadText(question)).toBeNull()
  })

  it('answers one with choices with one of them, and says what the bot goes ahead with', () => {
    const question = parseQuestions([
      card({ actions: ['answer'], choices: ['Roll back', 'Hotfix', ' '], recommended: 'Hotfix', going_ahead: true, chat: 's4', refs: [] })
    ])[0]
    expect(questionButtons(question).map(b => [b.label, b.recommended])).toEqual([
      ['Roll back', false],
      ['Hotfix', true]
    ])
    expect(answerRequest({ kind: 'choice', choice: 'Hotfix' })).toEqual({ action: 'answer', body: { choice: 'Hotfix' } })
    expect(goingAheadText(question)).toBe('Going ahead with “Hotfix” unless you pick another')
    expect(questionHeadline(question)).toBe('Asked you')
    expect(answersInWords(question)).toBe(false)
  })

  it('leaves a kept clarify question with no choices to its chat, in words', () => {
    const question = parseQuestions([card({ actions: ['answer'], source: 'clarify', going_ahead: true })])[0]
    expect(answersInWords(question)).toBe(true)
    expect(questionButtons(question)).toEqual([])
    expect(goingAheadText(question)).toBe('Going ahead unless you say no')
  })

  it('offers Dismiss when the plugin lists it, which answers nothing', () => {
    // hermes-conduit issue 3105: clearing a kept question by answering it fed the bot a made-up answer.
    expect(canDismiss(parseQuestions([card({})])[0])).toBe(false)
    const question = parseQuestions([card({ actions: ['answer', 'dismiss'], source: 'clarify' })])[0]
    expect(canDismiss(question)).toBe(true)
    expect(questionButtons(question)).toEqual([])
    expect(answerRequest({ kind: 'dismiss' })).toEqual({ action: 'dismiss', body: {} })
  })
})

describe('workMenuItems', () => {
  it('lists manage actions, run actions (without send), open chat, and copy branch for a workstream', () => {
    const item = parseItem({
      ref: 'W37',
      kind: 'workstream',
      status: 'running',
      session_id: 's37',
      branch: 'work/w37',
      actions: ['send', 'stop'],
      manage: ['pin', 'leave_alone']
    })!
    expect(workMenuItems(item, 'Infra')).toEqual([
      { kind: 'manage', action: 'pin', label: 'Pin' },
      { kind: 'manage', action: 'leave_alone', label: 'Keep Infra out of this' },
      { kind: 'action', action: 'stop', label: 'Stop' },
      { kind: 'open', label: 'Open W37’s chat' },
      { kind: 'copy-branch', branch: 'work/w37', label: 'Copy Branch' }
    ])
  })

  it('lists Pin and Resolve for an answered ask card', () => {
    const item = parseItem({
      ref: 'A94',
      kind: 'ask_in',
      status: 'done',
      bot: 'Network',
      manage: ['pin', 'resolve']
    })!
    expect(workMenuItems(item, 'Infra')).toEqual([
      { kind: 'manage', action: 'pin', label: 'Pin' },
      { kind: 'manage', action: 'resolve', label: 'Resolve' }
    ])
  })

  it('lists Reopen and Open chat for a resolved workstream, and nothing for a non-manageable ask', () => {
    const resolvedWs = parseItem({
      ref: 'W38',
      kind: 'workstream',
      status: 'done',
      closed: true,
      session_id: 's38',
      manage: ['reopen']
    })!
    expect(workMenuItems(resolvedWs, 'Infra')).toEqual([
      { kind: 'manage', action: 'reopen', label: 'Reopen' },
      { kind: 'open', label: 'Open W38’s chat' }
    ])
    const closedAsk = parseItem({
      ref: 'A95',
      kind: 'ask_out',
      status: 'stopped',
      closed: true,
      manage: []
    })!
    expect(workMenuItems(closedAsk, 'Infra')).toEqual([])
  })
})
