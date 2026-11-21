import { describe, expect, it } from 'vitest'
import { ScreenWindowSet } from '../src/main/screenWindowSet'
import { releaseScreen, screenWindowRequest } from '../src/shared/screenWindows'
import type { ScreenWindowRequest } from '../src/shared/ipc'

function harness() {
  const made: { screen: ScreenWindowRequest; focused: number; closed: boolean; onClosed: () => void; focus: () => void; close: () => void }[] = []
  const changes: string[][] = []
  const released: [string, string][] = []
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
    (profile, viewer) => released.push([profile, viewer])
  )
  return { set, made, changes, released }
}

describe("bots' screens in windows of their own", () => {
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
  })

  it('tries a hand back again only when Hermes did not refuse it', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => void waits.push(ms)
    let calls = 0
    const flaky = async () => {
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: -32603 })
    }
    expect(await releaseScreen(flaky, 'mira', 'v1', sleep)).toBe(true)
    expect(waits).toEqual([1000, 3000])
    calls = 0
    const refused = async () => {
      calls++
      throw Object.assign(new Error('not yours'), { code: -32000 })
    }
    expect(await releaseScreen(refused, 'mira', 'v1', sleep)).toBe(false)
    expect(calls).toBe(1)
  })
})
