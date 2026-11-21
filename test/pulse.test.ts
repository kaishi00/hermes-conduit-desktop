import { describe, expect, it } from 'vitest'
import { actionMessage, backText, canAct, canBeDone, canPutAwayForGood, clearedTitle, heading, layout, lookedText, parseFeed } from '../src/renderer/src/state/pulse'

const raw = {
  cards: [
    { id: 3, kind: 'noticed', topic: 'fact', level: 'screen', news: 'Rain tomorrow', item_id: null, looked: ['calendar', 'web', 'nope'], created_at: 1795013846 },
    { id: 2, kind: 'noticed', topic: 'deadline', item_id: 2, news: 'Passport', seen_at: 1795013000 },
    { id: 1, kind: 'followup', item_id: 1, chat_id: 'c1', chat_title: 'Chat', title: 'Send Dana the numbers', news: '', done_at: 1795013900, done_by: 'user' },
    { id: 4, kind: 'report', news: '**Three things**', dismissed_at: 1795013000, rest_until: 1795099400 },
    { kind: 'report' },
    'junk'
  ],
  unseen: 1,
  home_chat_id: 'pulse-chat',
  profile: 'work',
  quiet_now: 'until',
  quiet_ends_at: 1795099400
}

describe('the Pulse feed', () => {
  it('reads cards leniently, with the screen’s state', () => {
    const feed = parseFeed(raw)
    expect(feed.cards.map(c => c.id)).toEqual([3, 2, 1, 4])
    expect(feed).toMatchObject({ unseen: 1, homeChatId: 'pulse-chat', profile: 'work', quietNow: 'until', quietEndsAt: 1795099400000 })
    expect(feed.cards[0]).toMatchObject({ itemId: undefined, createdAt: 1795013846000 })
    expect(parseFeed({ quiet_now: 'never' }).quietNow).toBeNull()
  })

  it('gives each card the actions the phone does', () => {
    const [found, deadline, followup, report] = parseFeed(raw).cards as [any, any, any, any]
    expect([canAct(found), canBeDone(found)]).toEqual([true, true])
    expect([canAct(deadline), canBeDone(deadline)]).toEqual([true, true])
    // Done already: under Done and cleared, no Do it.
    expect(canAct(followup)).toBe(false)
    expect([canAct(report), canBeDone(report), canPutAwayForGood(report)]).toEqual([false, false, true])
    expect(heading(found)).toBe('Worth knowing')
    expect(heading(followup)).toBe('Follow-ups')
  })

  it('splits New, Earlier and Done and cleared', () => {
    const feed = parseFeed(raw)
    const sections = layout(feed.cards, new Set([3]))
    expect(sections.fresh.map(c => c.id)).toEqual([3])
    expect(sections.earlier.map(c => c.id)).toEqual([2])
    expect(sections.cleared.map(c => c.id)).toEqual([1, 4])
  })

  it('keeps only the newest morning brief up, as the phone does', () => {
    const feed = parseFeed({
      cards: [
        { id: 12, kind: 'noticed', topic: 'date', news: 'From Tuesday’s brief, still open', created_at: 1795000100 },
        { id: 11, kind: 'brief', news: 'Tuesday', created_at: 1795000000 },
        { id: 20, kind: 'brief', news: 'Wednesday', created_at: 1795086400 },
        { id: 5, kind: 'brief', news: 'Monday', created_at: 1794913600, seen_at: 1794913700 }
      ]
    })
    const sections = layout(feed.cards, new Set([11, 20]))
    expect(sections.fresh.map(c => c.id)).toEqual([20])
    // An older brief's open card stays a card of its own.
    expect(sections.earlier.map(c => c.id)).toEqual([12])
    expect(sections.cleared.map(c => c.id)).toEqual([11, 5])
    // One just acted on stays where it was.
    expect(layout(feed.cards, new Set(), new Set([11])).earlier.map(c => c.id)).toEqual([12, 11, 20])
  })

  it('words Do it by what the card is about', () => {
    const [found, deadline, followup] = parseFeed(raw).cards as [any, any, any]
    expect(actionMessage(followup)).toBe('Pulse reminded me: Send Dana the numbers\n\nGo ahead with it now.')
    expect(actionMessage(deadline)).toBe('Pulse brought this up: Passport\n\nHelp me take care of it before then.')
    expect(actionMessage({ ...found, kanbanTask: 't_9' })).toMatch(/Kanban task t_9/)
  })

  it('says when a put-off card comes back and what Pulse looked at', () => {
    const now = new Date(2026, 10, 18, 12).getTime()
    expect(backText(new Date(2026, 10, 18, 18).getTime(), now)).toBe('Back later today')
    expect(backText(new Date(2026, 10, 19, 9).getTime(), now)).toBe('Back tomorrow')
    expect(backText(new Date(2026, 11, 1).getTime(), now)).toBe('Back next week')
    const report = parseFeed(raw).cards[3]!
    expect(clearedTitle({ ...report, restUntil: new Date(2026, 10, 19, 9).getTime() }, now)).toBe('Not now · Back tomorrow')
    expect(lookedText(parseFeed(raw).cards[0]!, 'en')).toBe('Before writing this, Pulse looked at your calendar and the web.')
  })
})
