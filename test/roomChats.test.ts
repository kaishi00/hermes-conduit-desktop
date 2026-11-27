import { describe, expect, it } from 'vitest'
import { chatTitle, openRoomChat, parseChat, roomChatAgents, roomChatsClient, sameAsk, titleTaken, type PendingAsk, type RoomChat } from '../src/renderer/src/state/roomChats'

const steps = (over: Partial<Parameters<typeof openRoomChat>[0]> = {}, log: string[] = []) => ({
  chats: async (): Promise<RoomChat[]> => [],
  create: async (profile: string) => {
    log.push(`create ${profile}`)
    return { runtimeId: 'run-1', storedId: 'stored-1' }
  },
  register: async (roomId: string, chatId: string, profile: string) => {
    log.push(`register ${roomId} ${chatId} ${profile}`)
    return { roomId, chatId, notesSeq: 0 }
  },
  title: async (runtimeId: string, _profile: string, title: string) => void log.push(`title ${runtimeId} ${title}`),
  exists: async () => true,
  ...over
})

describe('a room’s private chat with your agent', () => {
  it('offers your agents still in a room with other people’s', () => {
    const members = [
      { memberId: 'default', profile: 'default', displayName: 'Hermes' },
      { memberId: 'work', profile: 'work' },
      { memberId: 'gone', profile: 'gone', out: 'left' },
      { memberId: 'default', profile: 'default', peer: true, displayName: 'Kuro' }
    ]
    expect(roomChatAgents(members, p => (p === 'work' ? 'Work' : undefined))).toEqual([
      { profile: 'default', name: 'Hermes' },
      { profile: 'work', name: 'Work' }
    ])
    expect(roomChatAgents(members.filter(m => !m.peer), () => undefined)).toEqual([])
  })

  it('opens the chat your Hermes keeps for the room', async () => {
    const log: string[] = []
    const opened = await openRoomChat(steps({ chats: async () => [{ roomId: 'r1', chatId: 'kept', notesSeq: 4 }] }, log), 'r1', 'Weekend hike', 'work')
    expect(opened).toEqual({ chatId: 'kept', title: 'About Weekend hike' })
    expect(log).toEqual([])
  })

  it('replaces one Hermes no longer has, registered before it’s titled', async () => {
    const log: string[] = []
    const opened = await openRoomChat(
      steps({ chats: async () => [{ roomId: 'r1', chatId: 'kept', notesSeq: 0 }], exists: async () => false }, log),
      'r1',
      ' ',
      'work'
    )
    expect(opened).toEqual({ chatId: 'stored-1', title: 'About a room' })
    expect(log).toEqual(['create work', 'register r1 stored-1 work', 'title run-1 About a room'])
  })

  it('takes the next title free, and never opens one without its stored id', async () => {
    const log: string[] = []
    let tries = 0
    const opened = await openRoomChat(
      steps(
        {
          title: async (_r, _p, title) => {
            log.push(title)
            if (++tries < 3) throw Object.assign(new Error('Title "x" is already in use'), { code: 4022 })
          }
        },
        log
      ),
      'r1',
      'Hike',
      'default'
    )
    expect(opened.title).toBe('About Hike (3)')
    expect(log.slice(-3)).toEqual(['About Hike', 'About Hike (2)', 'About Hike (3)'])
    await expect(openRoomChat(steps({ create: async () => ({ runtimeId: 'r', storedId: null }) }), 'r1', 'Hike', 'default')).rejects.toThrow()
    await expect(openRoomChat(steps({ title: async () => Promise.reject(new Error('boom')) }), 'r1', 'Hike', 'default')).rejects.toThrow('boom')
    expect(titleTaken(new Error('nope'))).toBe(false)
    expect(chatTitle('Book club')).toBe('About Book club')
  })

  it('reads and registers through the plugin, per profile', async () => {
    const calls: unknown[] = []
    const client = roomChatsClient(async (method, path, body) => {
      calls.push([method, path, body])
      return (method === 'GET' ? { ok: true, chats: [{ room_id: 'r1', chat_id: 'c1', notes_seq: 7 }, { room_id: '' }] } : { ok: true, chat: { room_id: 'r1', chat_id: 'c2' } }) as never
    })
    expect(await client.chats('work')).toEqual([{ roomId: 'r1', chatId: 'c1', notesSeq: 7 }])
    expect(await client.open('r1', 'c2', 'default')).toEqual({ roomId: 'r1', chatId: 'c2', notesSeq: 0 })
    expect(calls).toEqual([
      ['GET', '/api/plugins/conduit_push/rooms/chats?profile=work', undefined],
      ['PUT', '/api/plugins/conduit_push/rooms/chats', { room_id: 'r1', chat_id: 'c2' }]
    ])
    expect(parseChat({ room_id: 'r', chat_id: 'c', notes_seq: 'x' })).toEqual({ roomId: 'r', chatId: 'c', notesSeq: 0 })
  })
})

describe('asks waiting for their chat to open (#621)', () => {
  it('match their chat with the profile as rows name it', () => {
    const wrapUp: PendingAsk = { text: 'notes', storedId: 's1', profile: 'default' }
    expect(sameAsk(wrapUp, 's1', undefined)).toBe(true)
    expect(sameAsk(wrapUp, 's1', 'Default')).toBe(true)
    expect(sameAsk({ ...wrapUp, profile: 'Coder' }, 's1', 'coder')).toBe(true)
    expect(sameAsk(wrapUp, 's2', 'default')).toBe(false)
    expect(sameAsk(wrapUp, 's1', 'coder')).toBe(false)
  })
})
