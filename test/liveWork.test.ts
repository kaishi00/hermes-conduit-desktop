import { describe, expect, it } from 'vitest'
import { addPendingUser, applyEvent, emptyTranscript, holdSent } from '../src/renderer/src/state/transcript'
import { forwardedRow, liveWorkActive, liveWorkPath, noLiveWork, parseLiveWork } from '../src/renderer/src/state/liveWork'

describe('a chat’s turn running in the gateway, on hermes dashboard', () => {
  it('reads the turn, its agents’ own steps and the queue behind it, read-only', () => {
    const work = parseLiveWork({
      running: true,
      step: { phase: 'tool', tool: 'agents', since: 11 },
      agents: [
        { id: 'child-1', goal: ' Generate the office still ', phase: 'tool', tool: 'terminal', since: 13, started: 12 },
        { id: '', phase: 'thinking' },
        { id: 'child-2', phase: 'dancing' }
      ],
      queued: [
        { admission_id: 'adm-3', input_id: 'in-3', text: 'second', status: 'queued', sequence: 3 },
        { admission_id: 'adm-2', text: 'first', status: 'unknown', sequence: 2 },
        { admission_id: 'adm-1', text: 'running', status: 'started', sequence: 1 }
      ]
    })
    expect(work.running).toBe(true)
    expect(work.step).toEqual({ phase: 'tool', tool: 'agents' })
    expect(work.agents).toEqual([{ id: 'child-1', goal: 'Generate the office still', step: { phase: 'tool', tool: 'terminal' }, started: 12 }])
    expect(work.queued.map(row => [row.admissionId, row.status])).toEqual([['adm-2', 'unknown'], ['adm-3', 'queued']])
    // The dashboard serves none of the queue's verbs.
    expect(work.queued.every(row => row.readOnly && !row.canSendNow && !row.canEdit)).toBe(true)
    expect(liveWorkActive(work)).toBe(true)
    expect(liveWorkActive(parseLiveWork({ running: false, queued: [] }))).toBe(false)
    expect(parseLiveWork(null)).toEqual(noLiveWork)
  })

  it('names the chat and its profile', () => {
    expect(liveWorkPath('api 1')).toBe('/api/plugins/conduit_push/sessions/live-work?session_id=api%201')
    expect(liveWorkPath('api-1', 'nahida')).toContain('nahida')
  })

  it('puts a forwarded send at the back of the line until the next read', () => {
    const row = forwardedRow('adm-9', 'did you start them?', parseLiveWork({ queued: [{ admission_id: 'a', status: 'queued', sequence: 4 }] }).queued)
    expect(row).toMatchObject({ admissionId: 'adm-9', text: 'did you start them?', status: 'queued', sequence: 5, readOnly: true })
  })

  it('brings the oldest forwarded message back at the turn the dashboard relays without naming it', () => {
    let state = addPendingUser({ ...emptyTranscript }, 'first', [], 'u-1')
    state = holdSent(state, 'u-1', 'adm-1')
    state = holdSent(addPendingUser(state, 'second', [], 'u-2'), 'u-2', 'adm-2')
    expect(state.items).toEqual([])
    state = applyEvent(state, { type: 'message.start', payload: {} })
    expect(state.items).toMatchObject([{ kind: 'user', text: 'first' }])
    expect(state.held?.map(h => h.admission)).toEqual(['adm-2'])
  })
})
