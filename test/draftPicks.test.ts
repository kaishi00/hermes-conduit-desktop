import { describe, expect, it } from 'vitest'
import { keepDraft, type DraftPicks } from '../src/renderer/src/state/useChat'

const key = (draft: number) => `${draft}\nfalse\ndefault\nhost\ntrue\nfalse`

describe('kept New Chat picks (desktop#661)', () => {
  it('drops a closed draft’s picks before an open one’s', () => {
    const kept = new Map<string, DraftPicks>()
    const open = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    open.delete(5) // its tab closed
    for (let draft = 1; draft <= 13; draft++) keepDraft(kept, key(draft), { model: `m${draft}` }, d => open.has(d))
    expect(kept.size).toBe(12)
    expect(kept.has(key(1))).toBe(true) // shown longest ago, but its tab is still open
    expect(kept.has(key(5))).toBe(false)
  })

  it('drops the one shown longest ago when every draft is still open', () => {
    const kept = new Map<string, DraftPicks>()
    for (let draft = 1; draft <= 13; draft++) keepDraft(kept, key(draft), { model: `m${draft}` }, () => true)
    expect(kept.size).toBe(12)
    expect(kept.has(key(1))).toBe(false)
    expect(kept.has(key(13))).toBe(true)
  })

  it('keeps nothing for an unnumbered draft or one without picks', () => {
    const kept = new Map<string, DraftPicks>()
    keepDraft(kept, '\nfalse\ndefault\nhost\ntrue\nfalse', { model: 'm' })
    keepDraft(kept, key(1), {})
    expect(kept.size).toBe(0)
  })
})
