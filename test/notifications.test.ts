import { describe, expect, it } from 'vitest'
import { plainLine, requestNotification, turnNotification, untitledAsNone } from '../src/renderer/src/state/notifications'

describe('notifications', () => {
  it('tells a finished turn with its reply as one plain line', () => {
    expect(turnNotification('live-1', { text: '**Done.** See the table:\n\n| a | b |\n```\ncode\n```\nMEDIA:/tmp/x.ogg', status: 'complete' }, { storedId: 's1', title: 'Trip' })).toEqual({
      title: 'Trip',
      body: 'Done. See the table: a b',
      tag: 'turn-live-1'
    })
  })

  it('titles a reply in an untitled chat by its bot, as the phone does', () => {
    expect(turnNotification('l', { text: 'Done.', status: 'complete' }, { storedId: 's', bot: 'Kaleb' })).toMatchObject({ title: 'Kaleb', body: 'Done.' })
    expect(turnNotification('l', { text: 'Done.', status: 'complete' }, { storedId: 's', title: 'Trip', bot: 'Kaleb' })).toMatchObject({ title: 'Trip' })
    expect(turnNotification('l', { status: 'error', error: 'Model overloaded' }, { storedId: 's', bot: 'Kaleb' })).toMatchObject({ title: 'Kaleb' })
  })

  it('takes the list\'s "Untitled chat" and a window\'s "Chat" as no title, so the bot names the reply', () => {
    expect(untitledAsNone('Untitled chat')).toBeUndefined()
    expect(untitledAsNone('')).toBeUndefined()
    expect(untitledAsNone('Chat')).toBeUndefined()
    expect(untitledAsNone('Trip')).toBe('Trip')
    expect(turnNotification('l', { text: 'Done.', status: 'complete' }, { storedId: 's', title: 'Untitled chat', bot: 'Kaleb' })).toMatchObject({ title: 'Kaleb' })
    expect(turnNotification('l', { text: 'Done.', status: 'complete' }, { storedId: 's', title: 'Chat', bot: 'Kaleb' })).toMatchObject({ title: 'Kaleb' })
    expect(requestNotification({ id: 'r', method: 'approval', sessionId: 'l', params: { description: 'x' }, receivedAt: 0 }, { storedId: 's', title: 'Untitled chat' }).title).toBe('Needs your OK')
  })

  it('says a failure, and stays quiet about a stop', () => {
    expect(turnNotification('l', { status: 'error', error: 'Model overloaded' }, undefined)).toMatchObject({ title: 'Hermes', body: 'Model overloaded' })
    expect(turnNotification('l', { status: 'interrupted' }, undefined)).toBeNull()
  })

  it('names what an approval or a question wants', () => {
    expect(requestNotification({ id: 'r1', method: 'approval', sessionId: 'l', params: { description: 'delete in root path', command: 'rm -rf /tmp/x' }, receivedAt: 0 }, { storedId: 's', title: 'Cleanup' })).toEqual({
      title: 'Needs your OK · Cleanup',
      body: 'delete in root path: rm -rf /tmp/x',
      tag: 'ask-r1'
    })
    expect(requestNotification({ id: 'r2', method: 'clarify', sessionId: 'l', params: { questions: [{ qid: 'a', question: 'Which day?' }, { qid: 'b', question: 'Time?' }] }, receivedAt: 0 }, undefined)).toEqual({
      title: '2 questions',
      body: 'Which day?',
      tag: 'ask-r2'
    })
  })

  it('reads a table without its rule row', () => {
    expect(plainLine('The command printed **hello**.\n\n| Category | Spent |\n| --- | ---: |\n| Food | $5 |')).toBe('The command printed hello. Category Spent Food $5')
  })

  it('cuts a long line', () => {
    expect(plainLine('a'.repeat(300), 10)).toBe(`${'a'.repeat(9)}…`)
  })
})
