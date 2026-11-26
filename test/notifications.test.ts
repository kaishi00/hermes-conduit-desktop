import { describe, expect, it } from 'vitest'
import { keepChatRef, type ChatRef, plainLine, requestNotification, turnNotification, TurnReplies, untitledAsNone } from '../src/renderer/src/state/notifications'

describe('notifications', () => {
  it("keeps a chat's ref under the bot it opened in, not the next pick's", () => {
    const chats = new Map<string, ChatRef>()
    keepChatRef(chats, 'live-furina', 'furina', 'furina', { storedId: 's-f', profile: 'furina', bot: 'Furina' })
    // The render just after picking Zhongli: the pane still holds Furina's live session.
    keepChatRef(chats, 'live-furina', 'furina', 'zhongli', { storedId: 's-f', profile: 'zhongli', bot: 'Zhongli' })
    expect(chats.get('live-furina')).toMatchObject({ profile: 'furina', bot: 'Furina' })
    expect(turnNotification('live-furina', { text: 'Done.', status: 'complete' }, chats.get('live-furina'))).toMatchObject({ title: 'Furina' })
    // Zhongli's own session, once it opens; a profile spelled in another case is the same one.
    keepChatRef(chats, 'live-zhongli', 'Zhongli', 'zhongli', { storedId: 's-z', profile: 'zhongli', bot: 'Zhongli' })
    expect(chats.get('live-zhongli')).toMatchObject({ bot: 'Zhongli' })
    keepChatRef(chats, null, 'zhongli', 'zhongli', { storedId: null, bot: 'Zhongli' })
    expect(chats.size).toBe(2)
    // A default chat (no profile named) keeps its own too, and is the "default" profile spelled out.
    keepChatRef(chats, 'live-main', undefined, undefined, { storedId: 's-m', bot: 'Hermes' })
    keepChatRef(chats, 'live-main', undefined, 'zhongli', { storedId: 's-m', profile: 'zhongli', bot: 'Zhongli' })
    expect(chats.get('live-main')).toMatchObject({ bot: 'Hermes' })
    keepChatRef(chats, 'live-main', undefined, 'default', { storedId: 's-m', profile: 'default', title: 'Plans', bot: 'Hermes' })
    expect(chats.get('live-main')).toMatchObject({ title: 'Plans' })
  })

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

  it("stays quiet about a reply that is only a silence marker, as the plugin's push does", () => {
    expect(turnNotification('l', { text: '[SILENT]', status: 'complete' }, undefined)).toBeNull()
    expect(turnNotification('l', { text: '  *NO_REPLY*\n', status: 'complete' }, undefined)).toBeNull()
    expect(turnNotification('l', { text: 'Done.\n\n[SILENT]', status: 'complete' }, undefined)).toMatchObject({ body: 'Done.' })
    expect(turnNotification('l', { text: 'I stayed [SILENT] there.', status: 'complete' }, undefined)).toMatchObject({ body: 'I stayed [SILENT] there.' })
    expect(turnNotification('l', { text: '', status: 'complete' }, undefined)).toMatchObject({ body: 'Replied.' })
  })

  it('reads a Bot Chat turn that ends with no text by the reply it streamed last', () => {
    const replies = new TurnReplies()
    const turn = (events: Array<{ type: string; payload?: unknown }>) => {
      let streamed = ''
      for (const e of events) streamed = replies.note({ ...e, session_id: 'bc' })?.streamed ?? streamed
      return streamed
    }
    const silent = turn([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: 'Checking the board.' } },
      { type: 'tool.start', payload: { name: 'work' } },
      { type: 'tool.complete', payload: { name: 'work' } },
      { type: 'message.delta', payload: { text: '[SIL' } },
      { type: 'message.delta', payload: { text: 'ENT]' } },
      { type: 'message.complete', payload: { text: '', status: 'complete' } }
    ])
    expect(silent).toBe('[SILENT]')
    expect(turnNotification('bc', { text: '', status: 'complete' }, { storedId: 's', bot: 'Kaleb' }, silent)).toBeNull()
    const spoke = turn([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: 'W2 is done.' } },
      { type: 'message.complete', payload: { text: '', status: 'complete' } }
    ])
    expect(turnNotification('bc', { text: '', status: 'complete' }, { storedId: 's', bot: 'Kaleb' }, spoke)).toMatchObject({ title: 'Kaleb', body: 'W2 is done.' })
    // The turn's own text wins, and the next turn starts clean.
    expect(turnNotification('bc', { text: '[SILENT]', status: 'complete' }, undefined, 'W2 is done.')).toBeNull()
    expect(turn([{ type: 'message.start' }, { type: 'message.complete', payload: { text: 'Hi' } }])).toBe('')
  })

  it('closes a reply where the chat does: reasoning, and a reply sent whole', () => {
    const replies = new TurnReplies()
    const run = (events: Array<{ type: string; payload?: unknown }>) =>
      events.map(e => replies.note({ ...e, session_id: 'x' })).find(Boolean)?.streamed
    expect(run([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: 'Done.' } },
      { type: 'reasoning.delta', payload: { text: 'nothing more' } },
      { type: 'message.delta', payload: { text: '[SILENT]' } },
      { type: 'message.complete', payload: { text: '' } }
    ])).toBe('[SILENT]')
    expect(run([
      { type: 'message.start' },
      { type: 'message.interim', payload: { text: 'Looking now.', already_streamed: false } },
      { type: 'message.complete', payload: { text: '' } }
    ])).toBe('Looking now.')
    expect(run([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: 'Streamed.' } },
      { type: 'message.interim', payload: { text: 'Streamed.', already_streamed: true } },
      { type: 'message.complete', payload: { text: '' } }
    ])).toBe('Streamed.')
  })

  it('says when a turn started, and nothing for a turn it never saw start', () => {
    const replies = new TurnReplies()
    expect(replies.note({ type: 'message.start', session_id: 'a' }, 1000)).toBeNull()
    expect(replies.note({ type: 'message.complete', session_id: 'a', payload: { text: 'x' } }, 5000)).toEqual({ streamed: '', startedAt: 1000 })
    expect(replies.note({ type: 'message.complete', session_id: 'b', payload: { text: 'x' } })).toEqual({ streamed: '', startedAt: null })
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
