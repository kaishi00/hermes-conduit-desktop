import { describe, expect, it } from 'vitest'
import { CLOSE_GONE, CLOSE_REFUSED, CLOSE_SLOW, Drawn, inputFrame, parseFrame, parseList, reconnectDelayMs, reconnects, resizeFrame, socketQuery } from '../src/renderer/src/state/terminals'

const b64 = (text: string) => btoa(text)
const bytes = (text: string) => new TextEncoder().encode(text)
const decode = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null)

describe('terminals', () => {
  it('reads the list, with a reason when they are unavailable', () => {
    expect(parseList({ available: false, reason: 'Turned off', terminals: [] })).toEqual({ available: false, reason: 'Turned off', enabled: true, terminals: [] })
    const list = parseList({ available: true, terminals: [{ id: 't1', root: '/r', title: '', end: 12 }, { title: 'no id' }] })
    expect(list.terminals).toEqual([{ id: 't1', root: '/r', title: 'Terminal', exited: false, exitCode: null, end: 12 }])
  })

  it('decodes the socket frames', () => {
    const output = parseFrame(JSON.stringify({ type: 'output', b64: b64('hi\r\n'), end: 4 }))
    expect(output?.type).toBe('output')
    if (output?.type === 'output') expect(decode(output.bytes)).toBe('hi\r\n')
    expect(parseFrame(JSON.stringify({ type: 'exit', code: 130, end: 9 }))).toEqual({ type: 'exit', code: 130, end: 9 })
    expect(parseFrame(JSON.stringify({ type: 'hello', terminal: { id: 'a' }, start: 2, end: 5 }))).toMatchObject({ type: 'hello', start: 2, end: 5 })
    expect(parseFrame('not json')).toBeNull()
    expect(parseFrame(JSON.stringify({ type: 'output', b64: '%%%' }))).toBeNull()
    expect(JSON.parse(inputFrame('ls\r'))).toEqual({ type: 'input', data: 'ls\r' })
    expect(JSON.parse(resizeFrame(80, 24))).toEqual({ type: 'resize', cols: 80, rows: 24 })
  })

  it('draws a replay only from where it left off', () => {
    const drawn = new Drawn()
    expect(decode(drawn.fresh(bytes('hello'), 5))).toBe('hello')
    // A reconnect's replay overlaps what was drawn: only the new part is drawn.
    expect(decode(drawn.fresh(bytes('llo world'), 11))).toBe(' world')
    expect(drawn.fresh(bytes('world'), 11)).toBeNull()
    expect(drawn.end).toBe(11)
  })

  it('reconnects unless the terminal is gone, refused or ended', () => {
    expect(reconnects(CLOSE_SLOW, false)).toBe(true)
    expect(reconnects(1006, false)).toBe(true)
    expect(reconnects(CLOSE_GONE, false)).toBe(false)
    expect(reconnects(CLOSE_REFUSED, false)).toBe(false)
    expect(reconnects(1006, true)).toBe(false)
    expect(reconnectDelayMs(0)).toBe(500)
    expect(reconnectDelayMs(10)).toBe(10_000)
  })

  it('asks the socket from the last byte drawn', () => {
    expect(socketQuery('t1', 42)).toEqual({ id: 't1', since: '42' })
    expect(socketQuery('t1', 0, 'work')).toMatchObject({ id: 't1', since: '0' })
  })
})
