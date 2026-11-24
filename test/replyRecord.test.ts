import { describe, expect, it } from 'vitest'
import { ReplyRecord } from '../src/renderer/src/state/replyRecord'

describe("a Local Live reply's saved turn", () => {
  it('is the whole transcript of a reply that played out', () => {
    const reply = new ReplyRecord()
    expect(reply.started()).toBe('')
    reply.words('Once upon ')
    reply.words('a time.')
    expect(reply.transcript('Once upon a time.')).toEqual({ keep: 'Once upon a time.', whole: true })
    expect(reply.ended()).toBe('')
  })

  it('is what was heard of a reply that was cut, when the transcript ends first', () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.words('Once upon')
    reply.cancelled()
    expect(reply.transcript('Once upon a time, far away.')).toEqual({ keep: 'Once upon', whole: false })
    expect(reply.ended()).toBe('')
  })

  it('is saved once when the response ends before its transcript does', () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.words('Once upon')
    reply.cancelled()
    expect(reply.ended()).toBe('Once upon')
    // The late transcript is the same reply's: nothing more is saved, and the unplayed words stay off the line.
    expect(reply.transcript('Once upon a time, far away.')).toBeNull()
  })

  it('is saved once the same way when the server cut the reply without a cancel frame the call knows', () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.words('Once upon')
    expect(reply.ended()).toBe('Once upon')
    expect(reply.transcript('Once upon a time, far away.')).toBeNull()
  })

  it("doesn't carry a cut reply's words into the next reply", () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.words('First')
    reply.cancelled()
    expect(reply.ended()).toBe('First')
    expect(reply.started()).toBe('')
    reply.words('Second')
    reply.cancelled()
    expect(reply.transcript('Second reply, whole.')).toEqual({ keep: 'Second', whole: false })
  })

  it("starts over on the next reply's words when the server names no responses", () => {
    const reply = new ReplyRecord()
    reply.words('First')
    reply.cancelled()
    expect(reply.ended()).toBe('First')
    reply.words('Second')
    expect(reply.transcript('Second.')).toEqual({ keep: 'Second.', whole: true })
    // Replies that come as whole transcripts only are each saved.
    expect(reply.transcript('Third.')).toEqual({ keep: 'Third.', whole: true })
  })

  it('saves what was heard of a reply that never ended, when the next response starts', () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.words('Cut off')
    expect(reply.started()).toBe('Cut off')
    expect(reply.ended()).toBe('')
  })

  it('saves nothing of a reply cut before any word was shown', () => {
    const reply = new ReplyRecord()
    reply.started()
    reply.cancelled()
    expect(reply.ended()).toBe('')
    expect(reply.transcript('Never played.')).toEqual({ keep: '', whole: false })
  })
})
