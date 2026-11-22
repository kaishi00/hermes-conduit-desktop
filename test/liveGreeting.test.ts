import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanedGreeting, liveGreeting, openingTurn, setLiveGreeting, spokenGreeting } from '../src/renderer/src/state/liveGreeting'

describe('greet me when a call connects', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    })
  })

  it('is off until switched on, and says nothing first then', () => {
    expect(liveGreeting()).toBeNull()
    expect(openingTurn()).toBeNull()
    expect(spokenGreeting()).toBeNull()
  })

  it("greets in the model's own words with the field empty, as the phone's turn", () => {
    setLiveGreeting('')
    expect(liveGreeting()).toBe('')
    expect(openingTurn()).toBe(
      "[The call just connected. Greet the user in one short sentence so they know you're there and listening. Then wait for them.]"
    )
    expect(spokenGreeting()).toBe("Hi, I'm listening.")
  })

  it('says the greeting typed, on one line, without double quotes, clipped to 200', () => {
    setLiveGreeting('  Hey "boss",\n  ready  ')
    expect(liveGreeting()).toBe("Hey 'boss', ready")
    expect(openingTurn()).toContain(`Say: "Hey 'boss', ready" Then wait for them.]`)
    expect(spokenGreeting()).toBe("Hey 'boss', ready")
    expect(cleanedGreeting('x'.repeat(300))).toHaveLength(200)
    setLiveGreeting(null)
    expect(liveGreeting()).toBeNull()
  })
})
