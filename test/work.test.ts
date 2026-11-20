import { describe, expect, it } from 'vitest'
import { noteDashboardProfiles, setDashboardProfilesHost } from '../src/renderer/src/state/dashboardProfile'
import { doing, parseItem, parseWork, sections, sideWorkstreams, statusText, stripText, workPath, needsYou } from '../src/renderer/src/state/work'

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
    expect(stripText(snapshot)).toBe('2 working · 1 needs you')
    expect(stripText(parseWork({ resolved_count: 1 }))).toBe('Work')
    expect(stripText(parseWork({}))).toBeNull()
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
