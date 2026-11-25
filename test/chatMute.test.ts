import { describe, expect, it, vi } from 'vitest'
import { muteIds, muteOf, muteOfTarget, mutePath, muteProfilesToAsk, parseMutes, settingMute, turnNotifies, TurnMuteReads, TURN_MUTE_READ_MS, type MuteTarget } from '../src/renderer/src/state/chatMute'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({ id, title: id, pinned: false, ...extra })

describe('Muted chats', () => {
  it('reads the route on this computer’s clock and finds a mute by any of the chat’s ids', () => {
    const mutes = parseMutes(
      {
        ok: true,
        chats: [
          { session_ids: ['root', 'tip'], until: 99_999, remaining_s: 60 },
          { session_ids: ['forever'], until: null, remaining_s: null },
          { session_ids: ['ended'], until: 5, remaining_s: 0 },
          { session_ids: [], until: null, remaining_s: null }
        ]
      },
      1000
    )
    expect(mutes).toEqual([
      { ids: ['root', 'tip'], until: 61_000 },
      { ids: ['forever'], until: null }
    ])
    expect(parseMutes({ error: 'nope' })).toBeNull()
    const all = { default: mutes! }
    expect(muteOf(all, row('tip', { lineageRoot: 'elsewhere' }), 2000)).toEqual({ ids: ['root', 'tip'], until: 61_000 })
    expect(muteOf(all, row('branch', { lineageRoot: 'root' }), 2000)).toBeNull()
    expect(muteOf(all, row('tip'), 62_000)).toBeNull()
    expect(muteOf(all, row('forever'), 1e15)?.until).toBeNull()
    expect(muteOf(all, row('tip', { profile: 'work' }), 2000)).toBeNull()
    expect(muteOf(null, row('tip'))).toBeNull()
  })

  it('mutes and unmutes before the plugin answers, one mute per chat', () => {
    const branch = row('chat-2', { lineageRoot: 'chat-1', profile: 'Work' })
    expect(muteIds(branch)).toEqual(['chat-2'])
    let mutes = settingMute(null, branch, 900, 5)
    expect(mutes).toEqual({ work: [{ ids: ['chat-2'], until: 900_005 }] })
    expect(muteOf(mutes, row('chat-1', { profile: 'work' }), 6)).toBeNull()
    mutes = settingMute(mutes, row('chat-1', { profile: 'work' }), null, 6)
    expect(mutes!.work).toEqual([{ ids: ['chat-1'], until: null }, { ids: ['chat-2'], until: 900_005 }])
    mutes = settingMute(mutes, branch, 0)
    expect(muteOf(mutes, branch)).toBeNull()
    expect(muteOf(mutes, row('chat-1', { profile: 'work' }))).not.toBeNull()
  })

  it('asks a named profile’s plugin by name and the default without one', () => {
    expect(mutePath('default')).toBe('/api/plugins/conduit_push/notifications/muted-chats')
    expect(mutePath('my bot')).toBe('/api/plugins/conduit_push/notifications/muted-chats?profile=my%20bot')
  })
})

describe("a finished turn's notification and the chat's mute (hermes-conduit issue 3032)", () => {
  /** The plugin answering each profile's mutes from `byProfile` (by its `?profile=`, none for the default). */
  const plugin = (byProfile: Record<string, string[]>) =>
    vi.fn(async (_method: 'GET' | 'PUT', path: string) => {
      const profile = new URLSearchParams(path.split('?')[1] ?? '').get('profile') ?? 'default'
      return { ok: true, chats: (byProfile[profile] ?? []).map(id => ({ session_ids: [id], until: null, remaining_s: null })) }
    })

  it("doesn't notify for a chat muted in the mutes read, and asks nothing more", async () => {
    const http = plugin({})
    const mutes = { default: [{ ids: ['s1'], until: null }] }
    expect(await turnNotifies(http, mutes, row('s1'), ['default'])).toBe(false)
    expect(http).not.toHaveBeenCalled()
  })

  it('notifies for an unmuted chat once the plugin, asked at once, has no mute for it', async () => {
    const http = plugin({ work: ['other'] })
    expect(await turnNotifies(http, { work: [] }, row('s1', { profile: 'work' }), ['work'])).toBe(true)
    expect(http).toHaveBeenCalledWith('GET', expect.stringContaining('profile=work'))
  })

  it("doesn't notify for a chat muted on another device since the last read", async () => {
    const http = plugin({ work: ['s1'] })
    expect(await turnNotifies(http, { work: [] }, row('s1', { profile: 'work' }), ['work'])).toBe(false)
  })

  it("finds a never-opened chat's mute under any listed profile when nothing knows its profile", async () => {
    const target = { ...row('compacted'), profileUnknown: true }
    expect(muteOfTarget({ default: [], work: [{ ids: ['compacted'], until: null }] }, target)).not.toBeNull()
    // Its own profile known, only that profile counts.
    expect(muteOfTarget({ default: [], work: [{ ids: ['compacted'], until: null }] }, row('compacted'))).toBeNull()
    const http = plugin({ work: ['compacted'] })
    expect(await turnNotifies(http, { default: [], work: [] }, target, ['default', 'work'])).toBe(false)
    expect(http).toHaveBeenCalledTimes(2)
    expect(await turnNotifies(plugin({}), null, target, ['default', 'work'])).toBe(true)
  })

  it('notifies when the mutes can’t be read (an older plugin, the host away)', async () => {
    const http = vi.fn(async () => {
      throw new Error('404')
    })
    expect(await turnNotifies(http, null, row('s1'), ['default'])).toBe(true)
  })

  it('asks each profile once, the default profile whatever its bot is named', () => {
    const bots = [
      { name: 'main', isDefault: true },
      { name: 'Work', isDefault: false },
      { name: 'scout', isDefault: false }
    ]
    expect(muteProfilesToAsk(['default', 'work'], bots)).toEqual(['default', 'scout', 'work'])
    expect(muteProfilesToAsk([], [])).toEqual([])
  })
})

describe('mutes read for finished turns (desktop#539)', () => {
  it('ask each profile once for the turns ending within a few seconds, and again after', async () => {
    const asked: string[] = []
    const http = async (_method: 'GET' | 'PUT', path: string) => {
      asked.push(path)
      return { chats: path.includes('work') ? [{ session_ids: ['muted'], remaining_s: null }] : [] }
    }
    const reads = new TurnMuteReads(http)
    const target = (id: string): MuteTarget => ({ id, title: id, pinned: false, profileUnknown: true })
    const answers = await Promise.all([
      turnNotifies(http, null, target('a'), ['default', 'work'], reads),
      turnNotifies(http, null, target('muted'), ['default', 'work'], reads),
      turnNotifies(http, null, { ...target('b'), profileUnknown: false, profile: 'work' }, ['default', 'work'], reads)
    ])
    expect(answers).toEqual([true, false, true])
    expect(asked).toEqual([mutePath('default'), mutePath('work')])
    await reads.mutes('work', Date.now() + TURN_MUTE_READ_MS)
    expect(asked.length).toBe(3)
    reads.forget()
    await reads.mutes('default')
    expect(asked.length).toBe(4)
  })
})
