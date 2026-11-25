import { describe, expect, it } from 'vitest'
import {
  barOrder,
  excerptOf,
  newPin,
  nextBarIndex,
  normalizedLabel,
  overview,
  pinFor,
  pinForPassage,
  pinTitle,
  pinnedWhole,
  pinsOfChat,
  replyHolds,
  shownText,
  refreshed,
  resolved,
  withoutChat,
  type PinnedReply
} from '../src/renderer/src/state/pinnedReplies'

const reply = (key: string, text: string) => ({ kind: 'assistant', key, text })

describe('pinned replies', () => {
  it('keeps a reply’s start on one line, and labels trimmed', () => {
    expect(excerptOf('  First line\n\n  second   line ')).toBe('First line second line')
    expect(excerptOf('x'.repeat(400))).toHaveLength(280)

    // A reply that is only a board line still gets a stable excerpt, so a pin made
    // before its row id exists can be found again (issue 526).
    const boardOnly = '::conduit-board{id="cb-000000000002"}'
    expect(excerptOf(boardOnly)).toBe(boardOnly)

    // The directive stays internal to matching; the pin bar names the board, not its protocol line.
    expect(pinTitle(newPin(reply('row-2', boardOnly), 'c', undefined, 'Chat', 3))).toBe('Board')
    expect(normalizedLabel('  ')).toBeUndefined()
    expect(normalizedLabel(' Security\nrecommendations ')).toBe('Security recommendations')
  })

  it('finds a pin by row id, and a reply pinned as it arrived by its words', () => {
    const items = [reply('row-1', 'Same start'), { kind: 'user', key: 'row-2', text: 'more' }, reply('row-3', 'Same start')]
    const byRow = newPin(reply('row-1', 'Same start'), 'c', undefined, 'Chat', 1)
    expect(byRow.rowId).toBe(1)
    const live = newPin(reply('a-9', 'Same start'), 'c', undefined, 'Chat', 2)
    expect(live.rowId).toBeNull()
    const ids = resolved([byRow, live], items)
    // The row id claims its reply; the live pin takes the latest other one reading the same.
    expect(ids.get(byRow.id)).toBe('row-1')
    expect(ids.get(live.id)).toBe('row-3')
    expect(pinFor(items[2]!, [byRow, live], items)?.id).toBe(live.id)
    expect(refreshed([byRow, live], items)!.map(p => p.rowId)).toEqual([1, 3])
    expect(refreshed([byRow], items)).toBeNull()
  })

  it('orders the bar as the replies sit, and cycles back from the first', () => {
    const items = [reply('row-1', 'one'), reply('row-5', 'five')]
    const late = { ...newPin(items[0]!, 'c', 'default', 'Chat', 20) }
    const early = { ...newPin(items[1]!, 'c', 'default', 'Chat', 10) }
    const gone = { ...newPin(reply('row-99', 'gone'), 'c', 'default', 'Chat', 30) }
    expect(barOrder([early, late, gone], items).map(p => p.id)).toEqual([gone.id, late.id, early.id])
    expect(nextBarIndex(2, 3)).toBe(1)
    expect(nextBarIndex(0, 3)).toBe(2)
  })

  it('lists a section per chat, the open one first, and drops a deleted chat’s pins', () => {
    const pin = (chat: string, at: number, profile = 'default'): PinnedReply => ({ ...newPin(reply(`row-${at}`, 't'), chat, profile, chat, at) })
    const pins = [pin('a', 1), pin('b', 5), pin('a', 3), pin('c', 2, 'furina')]
    expect(overview(pins).map(s => s.pins[0]!.chat)).toEqual(['b', 'a', 'c'])
    expect(overview(pins, { chat: 'c', profile: 'Furina' }).map(s => s.pins[0]!.chat)).toEqual(['c', 'b', 'a'])
    expect(overview(pins)[1]!.pins.map(p => p.pinnedAt)).toEqual([3, 1])
    expect(pinsOfChat(pins, undefined, 'a')).toHaveLength(2)
    expect(pinsOfChat(pins, 'default', 'c')).toHaveLength(0)
    expect(withoutChat(pins, 'default', 'a').map(p => p.chat)).toEqual(['b', 'c'])
  })

  it('pins a passage beside the whole reply, shown and found by its words', () => {
    const items = [reply('row-1', 'Here is **the plan**: first, test.\n\nThen ship it.')]
    const whole = newPin(items[0]!, 'c', undefined, 'Chat', 1)
    const passage = newPin(items[0]!, 'c', undefined, 'Chat', 2, '  the plan: first,\ntest. ')
    expect(passage.passage).toBe('the plan: first,\ntest.')
    expect(shownText(passage)).toBe('the plan: first, test.')
    expect(pinTitle({ ...passage, label: 'Plan' })).toBe('Plan')
    // Both land on the reply; only the whole pin makes it Unpin reply.
    const ids = resolved([whole, passage], items)
    expect(ids.get(whole.id)).toBe('row-1')
    expect(ids.get(passage.id)).toBe('row-1')
    expect(pinFor(items[0]!, [passage], items)).toBeUndefined()
    expect(pinnedWhole([passage], items).size).toBe(0)
    expect(pinForPassage('the plan:  first, test.', items[0]!, [whole, passage], items)?.id).toBe(passage.id)
    expect(pinForPassage('Then ship it.', items[0]!, [whole, passage], items)).toBeUndefined()
    expect(newPin(items[0]!, 'c', undefined, 'Chat', 3, '   ').passage).toBeUndefined()
  })

  it('finds a passage pinned as its reply arrived in the latest reply opening alike that holds it', () => {
    const start = 'x'.repeat(300)
    const items = [reply('row-1', `${start} **Beta** came.`), reply('row-2', `${start} Gamma.`), reply('row-3', 'Other.')]
    const pin = newPin(reply('a-1', `${start} Beta came.`), 'c', undefined, 'Chat', 1, 'Beta came')
    expect(replyHolds(items[0]!.text, 'Beta came.')).toBe(true)
    // The later reply opens alike but doesn't hold it; the earlier one does.
    expect(resolved([pin], items).get(pin.id)).toBe('row-1')
    // Held by none: the latest opening alike.
    expect(resolved([pin], [items[1]!, items[2]!]).get(pin.id)).toBe('row-2')
  })
})
