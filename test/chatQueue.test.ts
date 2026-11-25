import { describe, expect, it } from 'vitest'
import { GatewayError } from '../src/renderer/src/gateway'
import { lostRows, queueFrom, queueRefusal, refusalMeansSettled, resendWords, waitingRows } from '../src/renderer/src/state/chatQueue'
import { addPendingUser, applyEvent, dropHeld, emptyTranscript, holdSent, reholdEdited, releaseHeld } from '../src/renderer/src/state/transcript'

describe('a chat’s queue on the Webapp', () => {
  it('reads Hermes’ pending rows, oldest first, with the verbs it serves', () => {
    const rows = queueFrom([
      { admission_id: 'b', input_id: 's2', text: 'second', status: 'queued', sequence: 2, controls: ['steer', 'replace'] },
      { admission_id: 'a', input_id: 's1', text: 'first', status: 'unknown', sequence: 1, execution_generation: 4, controls: [] },
      { admission_id: 'c', text: 'going in', status: 'started', sequence: 3, steering: true },
      { admission_id: '', status: 'queued' },
      { admission_id: 'd', status: 'weird' }
    ])!
    expect(rows.map(r => r.admissionId)).toEqual(['a', 'b', 'c'])
    expect(rows[1]).toMatchObject({ inputId: 's2', canSendNow: true, canEdit: true, steering: false })
    expect(lostRows(rows)).toMatchObject([{ admissionId: 'a', generation: 4 }])
    expect(waitingRows(rows).map(r => r.admissionId)).toEqual(['b'])
    // The dashboard's snapshot, or a session.info about something else, says nothing about the queue.
    expect(queueFrom(undefined)).toBeNull()
  })

  it('resends the typed words only, and says what became of a refused action', () => {
    expect(resendWords('@file:/tmp/a.png\n\nLook at this')).toBe('Look at this')
    expect(resendWords('@file:/tmp/a.png')).toBe('')
    expect(queueRefusal(new GatewayError('x', -32000, 'session_idle'))).toBe('No reply is running to send it into. It runs next.')
    expect(queueRefusal(new GatewayError('x', -32000, 'admission_terminal'))).toBe('That message isn’t waiting any more.')
    expect(queueRefusal(new Error('socket closed'))).toBe('Hermes couldn’t be reached. Check the queue before you try again.')
    expect(refusalMeansSettled(new GatewayError('not_found'))).toBe(true)
    expect(refusalMeansSettled(new GatewayError('x', 1, 'steer_unavailable'))).toBe(false)
  })

  it('keeps your queued message out of the transcript until its turn starts', () => {
    let state = applyEvent({ ...emptyTranscript, running: true }, { type: 'message.delta', payload: { text: 'Once upon ' } })
    state = addPendingUser(state, 'second', [], 'u-2')
    state = applyEvent(state, { type: 'message.delta', payload: { text: 'a time' } })
    state = holdSent(state, 'u-2', 'adm-2')
    // The reply its bubble split is one again.
    expect(state.items).toMatchObject([{ kind: 'assistant', text: 'Once upon a time', streaming: true }])
    state = applyEvent(state, { type: 'message.complete', payload: {} })
    // The listener names the admission on the event itself.
    state = applyEvent(state, { type: 'message.start', admission_id: 'adm-2' })
    expect(state.items.map(i => i.kind)).toEqual(['assistant', 'user'])
    expect(state.held).toEqual([])
  })

  it('marks a released held message and a live user.message as steers (issue 526)', () => {
    let state = holdSent(addPendingUser(emptyTranscript, 'turn left', [], 'u-1'), 'u-1', 'a1')
    expect(releaseHeld(state, 'a1', true).items).toMatchObject([{ kind: 'user', text: 'turn left', steer: true }])
    state = releaseHeld(state, 'a1')
    expect(state.items).toMatchObject([{ kind: 'user', text: 'turn left' }])
    expect(state.items[0]).not.toHaveProperty('steer')
    // A redirected correction carries display_kind steer; a queued one does not.
    const live = applyEvent(emptyTranscript, { type: 'user.message', payload: { text: 'turn left', display_kind: 'steer' } })
    expect(live.items).toMatchObject([{ kind: 'user', text: 'turn left', steer: true }])
  })

  it('drops a withdrawn one, moves an edited one, and brings a steered one back', () => {
    let state = holdSent(addPendingUser(emptyTranscript, 'hello', [], 'u-1'), 'u-1', 'a1')
    state = reholdEdited(state, 'a1', 'a2', 'hello there')
    expect(state.held).toMatchObject([{ admission: 'a2', item: { text: 'hello there' } }])
    expect(releaseHeld(state, 'a2').items).toMatchObject([{ kind: 'user', text: 'hello there' }])
    expect(dropHeld(state, 'a2').held).toEqual([])
  })
})
