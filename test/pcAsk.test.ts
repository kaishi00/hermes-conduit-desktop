import { describe, expect, it } from 'vitest'
import type { PcRequest } from '../src/shared/ipc'
import { askEverywhere, askPollDelay, batchStill, readAsk, requestsFrom, type AskSide } from '../src/renderer/src/state/pcControl'
import { declineLabel, askerLine, parsePrompt } from '../src/renderer/src/state/presented'

const request: PcRequest = { id: 'r1', session: 's1', chat: 'Tidy', action: 'capture', args: {}, needs_ok: true, ask: 'ask-1', bot: 'Nahida', profile: 'nahida', host: 'https://a.example', hostName: 'Home' }

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
    expect(await askEverywhere(request, s)).toBe('allowed')
    expect(calls.closed).toEqual(['s1'])
  })

  it('a phone no closes the dialog too', async () => {
    const { s, calls } = side({ phone: ['denied'] })
    expect(await askEverywhere(request, s)).toBe('denied')
    expect(calls.closed).toEqual(['s1'])
  })

  it('the dialog’s answer goes to the plugin, and the phone’s earlier answer stands', async () => {
    const { s, calls } = side({ local: Promise.resolve('allowed'), settle: 'denied' })
    expect(await askEverywhere(request, s)).toBe('denied')
    expect(calls.settled).toEqual(['allowed'])
  })

  it('an older plugin: the dialog alone decides', async () => {
    const { s, calls } = side({ local: new Promise(resolve => setTimeout(() => resolve('allowed'), 20)), phone: ['gone'], settle: 'gone' })
    expect(await askEverywhere(request, s)).toBe('allowed')
    expect(calls.closed).toEqual([])
  })

  it('without a phone copy only the dialog asks', async () => {
    const { s, calls } = side({ local: Promise.resolve('denied') })
    expect(await askEverywhere({ ...request, ask: undefined }, s)).toBe('denied')
    expect(calls.settled).toEqual([])
  })

  it('an ask that ran out is a no', async () => {
    const { s } = side({ phone: ['closed'] })
    expect(await askEverywhere(request, s)).toBe('denied')
  })

  // Desktop issue 735: Stop taking the dialog away is Stop, not the user's no.
  it('a dialog taken away here is stopped, with or without a phone copy', async () => {
    expect(await askEverywhere(request, side({ local: Promise.resolve('closed') }).s)).toBe('stopped')
    expect(await askEverywhere({ ...request, ask: undefined }, side({ local: Promise.resolve('closed') }).s)).toBe('stopped')
  })

  it('reads the phone’s copy less often while the dashboard can’t answer', async () => {
    const waits: number[] = []
    let reads = 0
    let close: (v: 'closed') => void = () => undefined
    const s: AskSide = {
      local: () => new Promise(resolve => (close = resolve)),
      close: () => close('closed'),
      read: async () => {
        reads++
        if (reads <= 3) throw new Error('offline')
        return 'allowed'
      },
      settle: async () => 'gone',
      wait: async ms => void waits.push(ms)
    }
    expect(await askEverywhere(request, s)).toBe('allowed')
    expect(waits).toEqual([1000, 2000, 4000, 8000])
    expect(askPollDelay(10)).toBe(8000)
  })
})

describe('batchStill', () => {
  it('goes ahead only while no Stop came since the batch, and never on a count it couldn’t read', () => {
    expect(batchStill({ ...request, gen: 2 }, 2)).toBe('go')
    expect(batchStill({ ...request, gen: 2 }, 3)).toBe('stopped')
    expect(batchStill({ ...request, gen: 2 }, undefined)).toBe('unknown')
    expect(batchStill(request, undefined)).toBe('go')
  })
})

describe('readAsk', () => {
  it('a plugin without the route is gone, and any other failure is passed on', async () => {
    expect(await readAsk(async () => ({ status: 'waiting' }))).toBe('waiting')
    expect(await readAsk(async () => ({ status: 'odd' }))).toBe('gone')
    expect(await readAsk(() => Promise.reject({ code: 404 }))).toBe('gone')
    await expect(readAsk(() => Promise.reject({ code: 502 }))).rejects.toEqual({ code: 502 })
  })
})

describe('computer asks', () => {
  it('requests carry the phone’s copy', () => {
    expect(requestsFrom({ requests: [{ id: 'r1', session: 's1', action: 'capture', ask: 'ask-1' }] }, 'p', 'P', 'https://a.example', 'Home')[0]?.ask).toBe('ask-1')
  })

  it('another computer’s ask reads as Allow or Don’t Allow', () => {
    const prompt = parsePrompt({ id: 'ask-1', title: 'Allow Nahida to control Asuka?', action_label: 'Allow', pc: { computer: 'c1', name: 'Asuka', bot: 'Nahida' } })!
    expect(prompt.pc).toEqual({ computer: 'c1', name: 'Asuka', bot: 'Nahida' })
    expect(askerLine(prompt)).toBe('Control from Hermes')
    expect(declineLabel(prompt)).toBe('Don’t Allow')
  })
})
