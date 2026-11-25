import { describe, expect, it, vi } from 'vitest'
import { TurnMuteReads, TURN_MUTE_READ_MS } from '../src/renderer/src/state/chatMute'

describe('a local unmute and the turn-mute cache (issue 550)', () => {
  it('uses the local answer until the cached read expires', async () => {
    let answer: unknown = { chats: [{ session_ids: ['a'], remaining_s: 60 }] }
    const get = vi.fn(async () => answer)
    const reads = new TurnMuteReads(get)
    expect((await reads.mutes('default')).map(m => m.ids)).toEqual([['a']])
    // The user unmuted here; the PUT is in flight and a turn may finish before the plugin replies.
    reads.seed('default', [])
    expect(await reads.mutes('default')).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
    // After the cache window a fresh read can bring a mute set elsewhere again.
    vi.useFakeTimers()
    const later = Date.now() + TURN_MUTE_READ_MS + 1
    vi.setSystemTime(later)
    answer = { chats: [{ session_ids: ['a'], remaining_s: 60 }] }
    const fresh = await reads.mutes('default', later)
    expect(fresh.map(m => m.ids)).toEqual([['a']])
    expect(get).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
