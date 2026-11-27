import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

const { quickAskHeight } = await import('../src/main/quickAsk')

describe('the quick ask window', () => {
  it('is the field alone, the full height for a reply, or as tall as staged files need', () => {
    expect(quickAskHeight(false)).toBe(128)
    expect(quickAskHeight(true)).toBe(460)
    expect(quickAskHeight(190.2)).toBe(191)
    expect(quickAskHeight(40)).toBe(128)
    expect(quickAskHeight(900)).toBe(460)
    expect(quickAskHeight(Number.NaN)).toBe(128)
  })
})
