import { describe, expect, it } from 'vitest'
import { AFTER_CALL_STALL_MS, afterCallStep, afterFailedSend, callChatId, chatOfCall, leftByCall } from '../src/renderer/src/state/afterCall'

const free = { chatId: 'chat', calling: false, running: false, turnsDone: 3, at: 1000 }

describe('requests a call left unsent (hermes-conduit issue 3185)', () => {
  it('keeps what a call left for its chat, and adds a later call’s in the same chat', () => {
    expect(leftByCall(null, 'chat', [])).toBeNull()
    const first = leftByCall(null, 'chat', [' book the hotel ', ''])
    expect(first).toEqual({ chatId: 'chat', requests: ['book the hotel'], sentAt: null, sentWhen: null })
    expect(leftByCall(first, 'chat', ['and a car'])?.requests).toEqual(['book the hotel', 'and a car'])
    expect(leftByCall(first, 'other', ['and a car'])).toEqual({ chatId: 'other', requests: ['and a car'], sentAt: null, sentWhen: null })
  })

  it('sends one once the chat is free, and the next after that reply ends', () => {
    const left = leftByCall(null, 'chat', ['book the hotel', 'and a car'])
    expect(afterCallStep(left, { ...free, running: true })).toEqual({ left })
    expect(afterCallStep(left, { ...free, calling: true })).toEqual({ left })
    const first = afterCallStep(left, free)
    expect(first.send).toBe('book the hotel')
    expect(first.left).toEqual({ chatId: 'chat', requests: ['and a car'], sentAt: 3, sentWhen: 1000 })
    // Its reply hasn't started or ended yet.
    expect(afterCallStep(first.left, free)).toEqual({ left: first.left })
    expect(afterCallStep(first.left, { ...free, running: true })).toEqual({ left: first.left })
    const second = afterCallStep(first.left, { ...free, turnsDone: 4 })
    expect(second).toEqual({ send: 'and a car', left: null })
  })

  it('keeps a later call’s behind the reply to the one already sent', () => {
    const sent = afterCallStep(leftByCall(null, 'chat', ['book the hotel', 'and a car']), free).left
    const merged = leftByCall(sent, 'chat', ['then lunch'])
    expect(merged).toEqual({ chatId: 'chat', requests: ['and a car', 'then lunch'], sentAt: 3, sentWhen: 1000 })
    expect(afterCallStep(merged, free)).toEqual({ left: merged })
  })

  it('follows a new chat that got its id from the first one sent', () => {
    for (const unmade of [null, 'new-1764039000000']) {
      const first = afterCallStep(leftByCall(null, unmade, ['book the hotel', 'and a car']), { ...free, chatId: unmade, turnsDone: 0 })
      expect(first.send).toBe('book the hotel')
      const made = { ...free, chatId: 'made', turnsDone: 0 }
      // Its reply still runs in the chat it made.
      expect(afterCallStep(first.left, { ...made, running: true })).toEqual({ left: { chatId: 'made', requests: ['and a car'], sentAt: 0, sentWhen: 1000 } })
      expect(afterCallStep(first.left, { ...made, turnsDone: 1 })).toEqual({ send: 'and a car', left: null })
    }
    // Nothing went yet: a chat opening then is another chat.
    expect(afterCallStep(leftByCall(null, null, ['book the hotel']), free)).toEqual({ left: null })
  })

  it('keeps a call’s chat while another chat opens and ends it', () => {
    // Started in chat A; B opens, the call ends on the next draw and hands over as it unmounts.
    let kept = chatOfCall(null, false, true, 'A')
    kept = chatOfCall(kept, true, true, 'B')
    kept = chatOfCall(kept, true, false, 'B')
    expect(kept).toBe('A')
    const left = leftByCall(null, kept, ['and a car'])
    expect(afterCallStep(left, { ...free, chatId: 'B' })).toEqual({ left: null })
    // A new chat that got its id from the call's first message is the call's chat.
    for (const unmade of [null, 'new-1764039000000']) {
      expect(chatOfCall(chatOfCall(unmade, false, true, unmade), true, true, 'made')).toBe('made')
    }
    // A new chat the call sent nothing: another chat opening isn't the call's.
    expect(chatOfCall(null, true, true, 'other', false)).toBeNull()

    // Only the id this call's own send created is its chat; a chat opened meanwhile is foreign.
    expect(callChatId(null, true, true, 'B', null)).toBeNull()
    expect(callChatId(null, true, true, 'B', 'A')).toBeNull()
    expect(callChatId(null, true, true, 'A', 'A')).toBe('A')
    expect(afterCallStep(leftByCall(null, null, ['and a car']), { ...free, chatId: 'other' })).toEqual({ left: null })
    // The next call takes the chat open as it starts.
    expect(chatOfCall('A', false, true, 'B')).toBe('B')
  })

  it('moves on from a send no reply followed, and from one the chat refused', () => {
    const first = afterCallStep(leftByCall(null, 'chat', ['/compact', 'and a car']), free)
    expect(first.send).toBe('/compact')
    expect(afterCallStep(first.left, { ...free, at: 1000 + AFTER_CALL_STALL_MS - 1 })).toEqual({ left: first.left })
    expect(afterCallStep(first.left, { ...free, at: 1000 + AFTER_CALL_STALL_MS })).toEqual({ send: 'and a car', left: null })
    // Refused: the rest go with it, unless a later call added to them meanwhile.
    expect(afterFailedSend(first.left, first.left)).toBeNull()
    const merged = leftByCall(first.left, 'chat', ['then lunch'])
    expect(afterFailedSend(merged, first.left)).toEqual({ chatId: 'chat', requests: ['and a car', 'then lunch'], sentAt: null, sentWhen: null })
    expect(afterFailedSend(null, null)).toBeNull()
  })

  it('drops them once another chat is open', () => {
    const left = leftByCall(null, 'chat', ['book the hotel'])
    expect(afterCallStep(left, { ...free, chatId: 'other' })).toEqual({ left: null })
    expect(afterCallStep(null, free)).toEqual({ left: null })
  })
})
