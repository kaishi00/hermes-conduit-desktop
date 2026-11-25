import { describe, expect, it } from 'vitest'
import { afterCallStep, leftByCall } from '../src/renderer/src/state/afterCall'

const free = { chatId: 'chat', calling: false, running: false, turnsDone: 3 }

describe('requests a call left unsent (hermes-conduit issue 3185)', () => {
  it('keeps what a call left for its chat, and adds a later call’s in the same chat', () => {
    expect(leftByCall(null, 'chat', [])).toBeNull()
    const first = leftByCall(null, 'chat', [' book the hotel ', ''])
    expect(first).toEqual({ chatId: 'chat', requests: ['book the hotel'], sentAt: null })
    expect(leftByCall(first, 'chat', ['and a car'])?.requests).toEqual(['book the hotel', 'and a car'])
    expect(leftByCall(first, 'other', ['and a car'])).toEqual({ chatId: 'other', requests: ['and a car'], sentAt: null })
  })

  it('sends one once the chat is free, and the next after that reply ends', () => {
    const left = leftByCall(null, 'chat', ['book the hotel', 'and a car'])
    expect(afterCallStep(left, { ...free, running: true })).toEqual({ left })
    expect(afterCallStep(left, { ...free, calling: true })).toEqual({ left })
    const first = afterCallStep(left, free)
    expect(first.send).toBe('book the hotel')
    expect(first.left).toEqual({ chatId: 'chat', requests: ['and a car'], sentAt: 3 })
    // Its reply hasn't started or ended yet.
    expect(afterCallStep(first.left, free)).toEqual({ left: first.left })
    expect(afterCallStep(first.left, { ...free, running: true })).toEqual({ left: first.left })
    const second = afterCallStep(first.left, { ...free, turnsDone: 4 })
    expect(second).toEqual({ send: 'and a car', left: null })
  })

  it('drops them once another chat is open', () => {
    const left = leftByCall(null, 'chat', ['book the hotel'])
    expect(afterCallStep(left, { ...free, chatId: 'other' })).toEqual({ left: null })
    expect(afterCallStep(null, free)).toEqual({ left: null })
  })
})
