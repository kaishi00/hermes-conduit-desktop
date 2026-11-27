import { describe, expect, it } from 'vitest'
import type { PcRequest } from '../src/shared/ipc'
import { askEverywhere, requestsFrom, type AskSide } from '../src/renderer/src/state/pcControl'
import { declineLabel, askerLine, parsePrompt } from '../src/renderer/src/state/presented'

const request: PcRequest = { id: 'r1', session: 's1', chat: 'Tidy', action: 'capture', args: {}, needs_ok: true, ask: 'ask-1', bot: 'Nahida', profile: 'nahida' }

function side(opts: { local?: Promise<'allowed' | 'denied' | 'closed'>; phone?: string[]; settle?: string }) {
  const calls = { closed: [] as string[], settled: [] as string[] }
  let close: (v: 'closed') => void = () => undefined
  const local = opts.local ?? new Promise<'allowed' | 'denied' | 'closed'>(resolve => (close = resolve))
  const phone = [...(opts.phone ?? [])]
  const s: AskSide = {
    local: () => local,
    close: session => {
      calls.closed.push(session)
      close('closed')
    },
    read: async () => (phone.shift() ?? 'waiting') as never,
    settle: async (_r, answer) => {
      calls.settled.push(answer)
      return (opts.settle ?? answer) as never
    },
    wait: () => new Promise(resolve => setTimeout(resolve, 1))
  }
  return { s, calls }
}

describe('askEverywhere', () => {
  it('takes the phone’s answer and closes the dialog', async () => {
    const { s, calls } = side({ phone: ['waiting', 'allowed'] })
    expect(await askEverywhere(request, s)).toBe(true)
    expect(calls.closed).toEqual(['s1'])
  })

  it('a phone no closes the dialog too', async () => {
    const { s, calls } = side({ phone: ['denied'] })
    expect(await askEverywhere(request, s)).toBe(false)
    expect(calls.closed).toEqual(['s1'])
  })

  it('the dialog’s answer goes to the plugin, and the phone’s earlier answer stands', async () => {
    const { s, calls } = side({ local: Promise.resolve('allowed'), settle: 'denied' })
    expect(await askEverywhere(request, s)).toBe(false)
    expect(calls.settled).toEqual(['allowed'])
  })

  it('an older plugin: the dialog alone decides', async () => {
    const { s, calls } = side({ local: new Promise(resolve => setTimeout(() => resolve('allowed'), 20)), phone: ['gone'], settle: 'gone' })
    expect(await askEverywhere(request, s)).toBe(true)
    expect(calls.closed).toEqual([])
  })

  it('without a phone copy only the dialog asks', async () => {
    const { s, calls } = side({ local: Promise.resolve('denied') })
    expect(await askEverywhere({ ...request, ask: undefined }, s)).toBe(false)
    expect(calls.settled).toEqual([])
  })

  it('an ask that ran out is a no', async () => {
    const { s } = side({ phone: ['closed'] })
    expect(await askEverywhere(request, s)).toBe(false)
  })
})

describe('computer asks', () => {
  it('requests carry the phone’s copy', () => {
    expect(requestsFrom({ requests: [{ id: 'r1', session: 's1', action: 'capture', ask: 'ask-1' }] }, 'p', 'P')[0]?.ask).toBe('ask-1')
  })

  it('another computer’s ask reads as Allow or Don’t Allow', () => {
    const prompt = parsePrompt({ id: 'ask-1', title: 'Allow Nahida to control Asuka?', action_label: 'Allow', pc: { computer: 'c1', name: 'Asuka', bot: 'Nahida' } })!
    expect(prompt.pc).toEqual({ computer: 'c1', name: 'Asuka', bot: 'Nahida' })
    expect(askerLine(prompt)).toBe('Control from Hermes')
    expect(declineLabel(prompt)).toBe('Don’t Allow')
  })
})
