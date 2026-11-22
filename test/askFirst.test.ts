import { describe, expect, it } from 'vitest'
import { AskFirst, DelegatedAskFirst, DROPPED, HELD_FOR_OK, NOTHING_WAITING, WAITING_FOR_ANSWER, adding, modeMarker } from '../src/renderer/src/state/askFirst'
import { briefing } from '../src/renderer/src/state/gptLive'
import { liveInstructions } from '../src/renderer/src/state/liveCall'

const clock = () => {
  let t = 1_000_000
  return { now: () => t, tick: (ms: number) => (t += ms) }
}

describe('asking first, tool modes', () => {
  it('sends at once while off', () => {
    expect(new AskFirst(false).hold('ask_thread', 'Book a table')).toBeNull()
  })

  it("holds a new request and sends it only on the user's own yes, with what they added", async () => {
    const c = clock()
    const ask = new AskFirst(true, c.now, 0)
    ask.heard('Book a table for two')
    expect(ask.hold('ask_thread', 'Book a table for two')?.status).toBe('waiting_for_ok')
    // Nothing said since: not sent.
    expect(await ask.release()).toMatchObject({ send: false, result: { status: 'waiting_for_ok' } })
    ask.modelSpoke()
    c.tick(3000)
    ask.heard('Yes, and make it for four')
    expect(await ask.release()).toEqual({ send: true, tool: 'ask_thread', request: adding('Yes, and make it for four', 'Book a table for two') })
    expect(ask.draft).toBeNull()
  })

  it('drops it on a no, keeps it on a wait, and asks again on anything else', async () => {
    const c = clock()
    const ask = new AskFirst(true, c.now, 0)
    const answer = async (words: string) => {
      ask.modelSpoke()
      c.tick(3000)
      ask.heard(words)
      return ask.release()
    }
    ask.hold('start_job', 'Clean the inbox')
    expect(await answer('Hold on')).toMatchObject({ send: false, result: { status: 'waiting_for_ok' } })
    expect(await answer('What is the weather?')).toMatchObject({ send: false, result: { status: 'waiting_for_ok' } })
    expect(await answer('No thanks')).toMatchObject({ send: false, result: { status: 'dropped' } })
    expect(ask.draft).toBeNull()
  })

  it('"send it to Hermes" sends the next request at once, and the switch lets a held one go', () => {
    const ask = new AskFirst(true)
    ask.heard('Check my calendar and send it to Hermes')
    expect(ask.hold('ask_thread', 'Check my calendar')).toBeNull()
    ask.hold('ask_thread', 'Another one')
    expect(ask.setMode('off')).toMatchObject({ status: 'off' })
    expect(ask.draft).toBeNull()
    expect(ask.setMode('maybe')).toEqual({ error: 'mode must be on or off' })
  })

  it('tells the models how it works and where the call starts', () => {
    expect(liveInstructions({ lookups: '', announces: true, asksFirst: true })).toContain('Asking first is on for this call')
    expect(liveInstructions({ lookups: '', announces: true, asksFirst: false })).toContain('call set_ask_first')
    expect(briefing('en', '', '', '', undefined, true)).toContain('delegate "Mode: ask first"')
    expect(briefing('en', '', '', '', undefined, true)).toContain('Asking first is on for this call')
  })
})

describe('asking first, GPT-Live', () => {
  it('passes everything through while off', () => {
    expect(new DelegatedAskFirst(false).delegation('d1', '', 'Book a table', 'Book a table', false)).toEqual({ kind: 'pass' })
  })

  it('holds a delegation, then sends it on a "Send:" the user said yes to', () => {
    const ask = new DelegatedAskFirst(true)
    expect(ask.delegation('d1', '', 'Book a table', 'Book a table', false)).toMatchObject({ kind: 'reply', text: HELD_FOR_OK })
    expect(ask.delegation('d2', 'Send:', 'Yes please', '', false)).toEqual({ kind: 'send', delegationId: 'd2', request: 'Book a table', background: false })
    // The same yes again: already sent.
    expect(ask.delegation('d3', 'Send:', '', '', false)).toMatchObject({ kind: 'reply', channel: 'commentary' })
  })

  it("a delegation before the user's words waits for them, and a no drops it whatever the model wrote", () => {
    const ask = new DelegatedAskFirst(true)
    ask.delegation('d1', '', 'Email Sam', 'Email Sam', false)
    expect(ask.delegation('d2', 'Send:', '', '', false)).toMatchObject({ text: WAITING_FOR_ANSWER })
    expect(ask.userFinished('No, never mind')).toEqual({ kind: 'reply', delegationId: 'd2', text: DROPPED, channel: 'commentary' })
    expect(ask.draft).toBeNull()
  })

  it('once the model asked, a plain yes sends it without a delegation; a change is held again', () => {
    const ask = new DelegatedAskFirst(true)
    ask.delegation('d1', '', 'Order pizza', 'Order pizza', true)
    expect(ask.userFinished('yes')).toBeNull() // the model hasn't asked yet
    ask.modelFinishedTurn()
    expect(ask.delegation('d2', '', 'Make it two', 'Make it two', false)).toMatchObject({ kind: 'reply', text: HELD_FOR_OK })
    expect(ask.draft?.request).toBe(adding('Make it two', 'Order pizza'))
    ask.modelFinishedTurn()
    expect(ask.userFinished('Sure')).toMatchObject({ kind: 'send', delegationId: 'd2', background: true })
  })

  it('"Send:" with nothing held, and the mode markers', () => {
    const ask = new DelegatedAskFirst(false)
    expect(ask.delegation('d1', 'Send:', 'yes', '', false)).toMatchObject({ text: NOTHING_WAITING, channel: 'speakable' })
    expect(modeMarker('Mode: ask first')).toBe(true)
    expect(modeMarker('mode: send directly')).toBe(false)
    expect(ask.mode('d2', 'Mode: ask first')).toMatchObject({ kind: 'reply' })
    expect(ask.on).toBe(true)
    expect(ask.mode('d3', 'Book a table')).toBeNull()
  })
})
