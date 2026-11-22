import { describe, expect, it } from 'vitest'
import { ScreenWindowSet } from '../src/main/screenWindowSet'
import { parseScreenKey, releaseScreen, screenKey, screenWindowHash, screenWindowRequest } from '../src/shared/screenWindows'
import type { ScreenWindowRequest } from '../src/shared/ipc'

function harness() {
  const made: { screen: ScreenWindowRequest; focused: number; closed: boolean; onClosed: () => void; focus: () => void; close: () => void }[] = []
  const changes: string[][] = []
  const released: [string, string][] = []
  const owed: (() => boolean)[] = []
  const set = new ScreenWindowSet(
    (screen, onClosed) => {
      const window = {
        screen,
        focused: 0,
        closed: false,
        onClosed,
        focus: () => window.focused++,
        close: () => {
          window.closed = true
          onClosed()
        }
      }
      made.push(window)
      return window
    },
    profiles => changes.push(profiles),
    (profile, viewer, stillOwed) => {
      released.push([profile, viewer])
      owed.push(stillOwed)
    }
  )
  return { set, made, changes, released, owed }
}

describe("bots' screens in windows of their own", () => {
  it("keeps two dashboards' bots of one name apart, by their dashboards", () => {
    const { set, made, released } = harness()
    set.show({ profile: 'default', botName: 'Furina', host: 'https://a.example' })
    set.show({ profile: 'default', botName: 'Conduit', host: 'https://b.example' })
    set.show({ profile: 'default', botName: 'Conduit', host: 'https://b.example' })
    expect(made).toHaveLength(2)
    expect(made[1]!.focused).toBe(1)
    expect(made[1]!.screen.host).toBe('https://b.example')
    const far = screenKey('https://b.example', 'default')
    expect(set.profiles()).toEqual([screenKey('https://a.example', 'default'), far])
    expect(parseScreenKey(far)).toEqual({ host: 'https://b.example', profile: 'default' })
    expect(parseScreenKey('mira')).toEqual({ profile: 'mira' })
    // The far dashboard leaves the group: its window closes and hands back its hold; the other stays.
    set.note(far, 'v2', true)
    set.closeWhere(key => parseScreenKey(key).host === 'https://b.example')
    expect(made[1]!.closed).toBe(true)
    expect(made[0]!.closed).toBe(false)
    expect(released).toEqual([[far, 'v2']])
    expect(set.profiles()).toEqual([screenKey('https://a.example', 'default')])
  })

  it('settles closeWhere once its hand backs have, so the dashboard can close after them (desktop#351)', async () => {
    let finish = () => {}
    const set = new ScreenWindowSet(
      () => ({ focus: () => undefined, close: () => undefined }),
      () => undefined,
      () => new Promise<void>(resolve => (finish = resolve))
    )
    const far = screenKey('https://b.example', 'mira')
    set.show({ profile: 'mira', botName: 'Mira', host: 'https://b.example' })
    set.note(far, 'v1', true)
    let settled = false
    void set.closeWhere(key => key === far).then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(true)
  })

  it("carries a far bot's dashboard in its page's hash", () => {
    const screen = { profile: 'default', botName: 'Conduit', host: 'https://b.example' }
    expect(screenWindowRequest(screenWindowHash(screen))).toEqual(screen)
  })

  it('opens one window per bot and focuses its own again', () => {
    const { set, made, changes } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.show({ profile: 'mira', botName: 'Mira' })
    set.show({ profile: 'default', botName: 'Hermes' })
    expect(made).toHaveLength(2)
    expect(made[0]!.focused).toBe(1)
    expect(set.profiles()).toEqual(['mira', 'default'])
    made[0]!.close()
    expect(set.profiles()).toEqual(['default'])
    expect(changes.at(-1)).toEqual(['default'])
  })

  it('hands back a hold when its window closes, and reopens as the same viewer', () => {
    const { set, made, released } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(made[0]!.screen.viewerId).toBeUndefined()
    set.note('mira', 'v1', true)
    made[0]!.close()
    expect(released).toEqual([['mira', 'v1']])
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(made[1]!.screen.viewerId).toBe('v1')
    // Handed back already: closing again sends nothing.
    set.note('mira', 'v1', false)
    made[1]!.close()
    expect(released).toHaveLength(1)
  })

  it('cancels a hand back still being tried once the window reopens or takes over again', () => {
    const { set, made, owed } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.note('mira', 'v1', true)
    made[0]!.close()
    expect(owed[0]!()).toBe(true)
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(owed[0]!()).toBe(false)
    set.note('mira', 'v1', true)
    made[1]!.close()
    expect(owed[1]!()).toBe(true)
    set.note('mira', 'v1', true)
    expect(owed[1]!()).toBe(false)
  })

  it('a hand back cut short by a reopen is sent again when the window closes before its page attaches', () => {
    const { set, made, released, owed } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.note('mira', 'v1', true)
    made[0]!.close()
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(owed[0]!()).toBe(false)
    made[1]!.close()
    expect(released).toEqual([
      ['mira', 'v1'],
      ['mira', 'v1']
    ])
    expect(owed[1]!()).toBe(true)
  })

  it('a finished hand back leaves nothing owed for the next window', async () => {
    const { set, made, released } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.note('mira', 'v1', true)
    made[0]!.close()
    await Promise.resolve()
    await Promise.resolve()
    set.show({ profile: 'mira', botName: 'Mira' })
    made[1]!.close()
    expect(released).toHaveLength(1)
  })

  it('another dashboard stops a hand back still being tried, and a later one never revives it', () => {
    const { set, made, owed } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.note('mira', 'v1', true)
    made[0]!.close()
    set.close(true)
    expect(owed[0]!()).toBe(false)
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(made[1]!.screen.viewerId).toBeUndefined()
    set.note('mira', 'v2', true)
    made[1]!.close()
    expect(owed[1]!()).toBe(true)
    expect(owed[0]!()).toBe(false)
  })

  it('closing every window hands back a hold itself, under its screen key', () => {
    const { set, released } = harness()
    const key = screenKey('http://far:9119', 'mira')
    set.show({ profile: 'mira', botName: 'Mira', host: 'http://far:9119' })
    set.note(key, 'v1', true)
    set.close()
    expect(released).toEqual([[key, 'v1']])
  })

  it('another dashboard closes every window and forgets its viewers', () => {
    const { set, made, released } = harness()
    set.show({ profile: 'mira', botName: 'Mira' })
    set.note('mira', 'v1', false)
    set.close(true)
    expect(made[0]!.closed).toBe(true)
    expect(released).toEqual([])
    set.show({ profile: 'mira', botName: 'Mira' })
    expect(made[1]!.screen.viewerId).toBeUndefined()
  })

  it('reads its request from the page hash', () => {
    const hash = `#screen=${encodeURIComponent(JSON.stringify({ profile: 'mira', botName: 'Mira', viewerId: 'v1' }))}`
    expect(screenWindowRequest(hash)).toEqual({ profile: 'mira', botName: 'Mira', viewerId: 'v1' })
    expect(screenWindowRequest('#screen=%7B%7D')).toBeNull()
    expect(screenWindowRequest('#chat=x')).toBeNull()
    expect(screenWindowRequest(screenWindowHash({ profile: 'mira', botName: 'Mira', viewerId: 'v2' }))?.viewerId).toBe('v2')
  })

  it('tries a hand back again only when Hermes did not refuse it', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => void waits.push(ms)
    let calls = 0
    const flaky = async () => {
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: -32603 })
    }
    expect(await releaseScreen(flaky, 'mira', 'v1', () => true, sleep)).toBe(true)
    expect(waits).toEqual([1000, 3000])
    calls = 0
    const refused = async () => {
      calls++
      throw Object.assign(new Error('not yours'), { code: -32000 })
    }
    expect(await releaseScreen(refused, 'mira', 'v1', () => true, sleep)).toBe(false)
    expect(calls).toBe(1)
    // Overtaken by a new takeover: the next try isn't sent.
    calls = 0
    let stillOwed = true
    const down = async () => {
      calls++
      stillOwed = false
      throw new Error('Not connected')
    }
    expect(await releaseScreen(down, 'mira', 'v1', () => stillOwed, sleep)).toBe(false)
    expect(calls).toBe(1)
  })
})
