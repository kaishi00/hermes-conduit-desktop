import { describe, expect, it } from 'vitest'
import { CHAT_WINDOW_LIMIT, ChatWindowSet } from '../src/main/chatWindowSet'
import { chatWindowRequest, chatWindowTitle, dockedChatRequest, dockedChatUrl } from '../src/shared/chatWindows'

function harness() {
  const made: { id: string; focused: number; closed: boolean; onClosed: () => void }[] = []
  const changes: string[][] = []
  const set = new ChatWindowSet(
    (chat, onClosed) => {
      const window = {
        id: chat.id,
        focused: 0,
        closed: false,
        onClosed,
        focus: () => window.focused++,
        close: () => {
          window.closed = true
          onClosed()
        }
      }
      made.push(window)
      return window
    },
    ids => changes.push(ids)
  )
  return { set, made, changes }
}

describe('chat windows of their own', () => {
  it('opens one per chat, up to the limit, and focuses a chat’s own window again', () => {
    const { set, made, changes } = harness()
    expect(CHAT_WINDOW_LIMIT).toBe(6)
    expect(set.show({ id: 'a' })).toBe(true)
    expect(set.show({ id: 'a' })).toBe(true)
    expect(made).toHaveLength(1)
    expect(made[0]!.focused).toBe(1)
    for (const id of ['b', 'c', 'd', 'e', 'f']) expect(set.show({ id })).toBe(true)
    expect(set.show({ id: 'g' })).toBe(false)
    expect(set.ids()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(changes.at(-1)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    // The user closing one makes room.
    made[1]!.onClosed()
    expect(set.ids()).toEqual(['a', 'c', 'd', 'e', 'f'])
    expect(set.show({ id: 'g' })).toBe(true)
  })

  it('closes named chats’ windows, or every one on a switch', () => {
    const { set, made, changes } = harness()
    set.show({ id: 'a' })
    set.show({ id: 'b' })
    set.close(['a', 'zzz'])
    expect(made[0]!.closed).toBe(true)
    expect(set.ids()).toEqual(['b'])
    const before = changes.length
    set.close(['zzz'])
    expect(changes).toHaveLength(before)
    set.close()
    expect(set.ids()).toEqual([])
    expect(made.every(w => w.closed)).toBe(true)
  })

  it('closes only the windows of a dashboard that went, keeping the combined ones', () => {
    const { set, made, changes } = harness()
    set.show({ id: 'a', host: 'https://a.example' })
    set.show({ id: 'b', host: 'https://b.example' })
    set.show({ id: 'c', host: 'https://c.example' })
    const open = ['https://a.example', 'https://b.example']
    set.closeWhere(chat => !open.includes(chat.host ?? ''))
    expect(made.map(w => w.closed)).toEqual([false, false, true])
    expect(changes.at(-1)).toEqual(['a', 'b'])
    // A closed window's chat isn't picked again.
    const before = changes.length
    set.closeWhere(chat => chat.id === 'c')
    expect(changes).toHaveLength(before)
  })

  it('reads its chat from the page’s hash', () => {
    const chat = { id: 's1', profile: 'ops', title: 'Plans & “ideas”', author: 'Nahida' }
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify(chat))}`)).toEqual(chat)
    expect(chatWindowRequest('#quick')).toBeNull()
    expect(chatWindowRequest('#chat=%7B%7D')).toBeNull()
    expect(chatWindowRequest('#chat=%zz')).toBeNull()
    // A Bot Chat says so; anything but true is left out.
    const botChat = { id: 'b1', profile: 'ops', botChat: true, host: 'https://b.example' }
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify(botChat))}`)).toEqual(botChat)
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify({ id: 'b1', botChat: 'yes' }))}`)).toEqual({ id: 'b1' })
  })

  it('docks another dashboard’s chat at the main window’s own page, and lets in nothing else', () => {
    const main = 'file:///app/out/renderer/index.html'
    const chat = { id: 's1', profile: 'ops', title: 'Plans', host: 'https://b.example', botChat: true }
    const src = dockedChatUrl(`${main}#ignored`, chat)
    expect(src.startsWith(`${main}#chat=`)).toBe(true)
    expect(dockedChatRequest(src, main)).toEqual({ ...chat, docked: true })
    // The page reads it as a chat window's request, docked.
    expect(chatWindowRequest(src.slice(main.length))).toEqual({ ...chat, docked: true })
    // Another page, a chat window's request that isn't docked, or one naming no dashboard isn't let in.
    expect(dockedChatRequest(src.replace('/app/', '/elsewhere/'), main)).toBeNull()
    expect(dockedChatRequest(`https://evil.example/#chat=${src.split('#chat=')[1]}`, main)).toBeNull()
    expect(dockedChatRequest(`${main}#chat=${encodeURIComponent(JSON.stringify(chat))}`, main)).toBeNull()
    expect(dockedChatRequest(`${main}#chat=${encodeURIComponent(JSON.stringify({ id: 's1', docked: true }))}`, main)).toBeNull()
    expect(dockedChatRequest(src, '')).toBeNull()
    // A dev server's page works the same.
    expect(dockedChatRequest(dockedChatUrl('http://localhost:5173/', chat), 'http://localhost:5173/')).toEqual({ ...chat, docked: true })
  })

  it('titles a window by its chat, then its bot', () => {
    expect(chatWindowTitle('Trip plans', 'Nahida')).toBe('Trip plans — Nahida')
    // A Bot Chat goes by its bot's name alone.
    expect(chatWindowTitle('Nahida', 'Nahida')).toBe('Nahida')
    expect(chatWindowTitle('Trip plans')).toBe('Trip plans')
    expect(chatWindowTitle('  ', 'Nahida')).toBe('Nahida')
    expect(chatWindowTitle('')).toBe('Conduit')
  })
})
