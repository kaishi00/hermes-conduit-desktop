// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { DAYS_BEFORE_OFFER, hostClients, iphoneCardDone, noteDayUsed, offersIphone, retireIphoneCard } from '../src/renderer/src/state/otherApp'

beforeEach(() => localStorage.clear())

describe('hostClients', () => {
  it('reads whether an iPhone reached the host and whether pushes are paired', () => {
    const status = (ios: unknown, push = 'not_paired') => ({ ok: true, push: { state: push }, clients: { ios, desktop: { seen_at: 5, open_sockets: 1 } } })
    expect(hostClients(status({ seen_at: null, open_sockets: 0 }))).toEqual({ iphoneSeen: false, pushPaired: false })
    expect(hostClients(status({ seen_at: 10, open_sockets: 0 }))).toEqual({ iphoneSeen: true, pushPaired: false })
    expect(hostClients(status({ seen_at: null, open_sockets: 2 }))).toEqual({ iphoneSeen: true, pushPaired: false })
    expect(hostClients(status({ seen_at: null, open_sockets: 0 }, 'ok'))).toEqual({ iphoneSeen: false, pushPaired: true })
  })

  it('says nothing for a plugin before 0.207 or an unreadable answer', () => {
    expect(hostClients({ ok: true, push: { state: 'not_paired' }, app: {} })).toBeNull()
    expect(hostClients(null)).toBeNull()
    expect(hostClients('x')).toBeNull()
  })
})

describe('offersIphone', () => {
  const none = { iphoneSeen: false, pushPaired: false }
  it('offers only where nothing says the person has the iPhone app, after three days, once', () => {
    expect(offersIphone(none, DAYS_BEFORE_OFFER, false)).toBe(true)
    expect(offersIphone(none, DAYS_BEFORE_OFFER - 1, false)).toBe(false)
    expect(offersIphone(none, DAYS_BEFORE_OFFER, true)).toBe(false)
    expect(offersIphone({ iphoneSeen: true, pushPaired: false }, DAYS_BEFORE_OFFER, false)).toBe(false)
    // Only the phone pairs a host with Conduit's push relay.
    expect(offersIphone({ iphoneSeen: false, pushPaired: true }, DAYS_BEFORE_OFFER, false)).toBe(false)
    expect(offersIphone(null, DAYS_BEFORE_OFFER, false)).toBe(false)
  })
})

describe('days used and the card', () => {
  it('counts separate days, not launches', () => {
    expect(noteDayUsed(new Date(2026, 10, 1, 9))).toBe(1)
    expect(noteDayUsed(new Date(2026, 10, 1, 20))).toBe(1)
    expect(noteDayUsed(new Date(2026, 10, 3))).toBe(2)
    expect(noteDayUsed(new Date(2026, 10, 9))).toBe(3)
    expect(noteDayUsed(new Date(2026, 10, 10))).toBe(3)
  })

  it('stays retired once closed or used', () => {
    expect(iphoneCardDone()).toBe(false)
    retireIphoneCard()
    expect(iphoneCardDone()).toBe(true)
  })
})
