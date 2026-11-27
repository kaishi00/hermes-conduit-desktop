import { describe, expect, it } from 'vitest'
import { parseReplySpeeds, replySpeedFor, replySpeedLabel, replySpeedsPath } from '../src/renderer/src/state/replySpeeds'

describe('reply speeds', () => {
  it('keeps saved replies by row and the newest unsaved turn apart', () => {
    const speeds = parseReplySpeeds({
      replies: [
        { row_id: 12, tokens_per_s: 48.6 },
        { row_id: null, tokens_per_s: 9 }, // an older turn whose reply never saved
        { row_id: 20, tokens_per_s: -1 },
        { row_id: '30', tokens_per_s: 30 },
        { row_id: null, tokens_per_s: 61.2 }
      ]
    })
    expect([...speeds.byRow]).toEqual([[12, 48.6]])
    expect(speeds.unsaved).toBe(61.2)
    expect(parseReplySpeeds(null)).toEqual({ byRow: new Map() })
  })

  it('gives a reply its own speed, and the unsaved one only to the newest reply once its turn ends', () => {
    const speeds = { byRow: new Map([[7, 42]]), unsaved: 55 }
    expect(replySpeedFor(speeds, { key: 'row-7', rowId: 7 }, 'live', false)).toBe(42)
    expect(replySpeedFor(speeds, { key: 'row-9', rowId: 9 }, 'live', false)).toBeUndefined()
    expect(replySpeedFor(speeds, { key: 'live' }, 'live', false)).toBe(55)
    expect(replySpeedFor(speeds, { key: 'live' }, 'live', true)).toBeUndefined()
    expect(replySpeedFor(speeds, { key: 'old' }, 'live', false)).toBeUndefined()
    expect(replySpeedFor(undefined, { key: 'row-7', rowId: 7 }, 'live', false)).toBeUndefined()
  })

  it('keeps a decimal only under ten', () => {
    expect(replySpeedLabel(41.6)).toBe('42 tok/s')
    expect(replySpeedLabel(4.46)).toBe('4.5 tok/s')
    expect(replySpeedLabel(9.97)).toBe('10 tok/s')
  })

  it('names the chat and its profile', () => {
    expect(replySpeedsPath('a b')).toContain('/api/plugins/conduit_push/sessions/reply-speeds?session_id=a%20b')
  })
})
