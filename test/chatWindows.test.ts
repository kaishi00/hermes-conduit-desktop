import { describe, expect, it } from 'vitest'
import { CHAT_WINDOW_LIMIT, ChatWindowSet } from '../src/main/chatWindowSet'
import { LIVE_CALL_WINDOW_ID, chatWindowRequest, chatWindowTitle, dockedChatRequest, dockedChatUrl, dockedFrameHost, dockedPulseUrl, dockedRoomUrl, pulseFrameRequest, roomFrameRequest } from '../src/shared/chatWindows'

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

  it('gives the Live call window its chat’s id once the call makes the chat', () => {
    const { set, made, changes } = harness()
    set.show({ id: LIVE_CALL_WINDOW_ID, host: 'https://a.example', fresh: true, call: true })
    set.show({ id: 'other' })
    expect(set.rename(LIVE_CALL_WINDOW_ID, 's9')).toBe(true)
    expect(set.ids()).toEqual(['other', 's9'])
    expect(changes.at(-1)).toEqual(['other', 's9'])
    // Its row brings it forward, a delete closes it, and the closing window drops its new id.
    expect(set.show({ id: 's9' })).toBe(true)
    expect(made[0]!.focused).toBe(1)
    expect(made).toHaveLength(2)
    set.close(['s9'])
    expect(made[0]!.closed).toBe(true)
    expect(set.ids()).toEqual(['other'])
    // Nothing to rename, or a chat that has a window already.
    expect(set.rename(LIVE_CALL_WINDOW_ID, 's9')).toBe(false)
    set.show({ id: LIVE_CALL_WINDOW_ID, call: true })
    expect(set.rename(LIVE_CALL_WINDOW_ID, 'other')).toBe(false)
    // The user closing a renamed window frees its place.
    expect(set.rename(LIVE_CALL_WINDOW_ID, 's10')).toBe(true)
    made[2]!.onClosed()
    expect(set.ids()).toEqual(['other'])
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

  it('reads the Live call window, a new chat that starts its call as it opens', () => {
    const call = { id: LIVE_CALL_WINDOW_ID, profile: 'ops', author: 'Nahida', host: 'https://a.example', fresh: true, call: true }
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify(call))}`)).toEqual(call)
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify({ id: 's1', call: 1 }))}`)).toEqual({ id: 's1' })
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

  it('docks another dashboard’s Pulse feed the same way, and reads a docked chat’s words and new chat', () => {
    const main = 'file:///app/out/renderer/index.html'
    const src = dockedPulseUrl(main, 'https://b.example')
    expect(pulseFrameRequest(src.slice(main.length))).toEqual({ host: 'https://b.example' })
    expect(dockedFrameHost(src, main)).toBe('https://b.example')
    expect(dockedFrameHost(dockedChatUrl(main, { id: 's1', host: 'https://c.example' }), main)).toBe('https://c.example')
    // Another page, or a feed that isn't docked or names no dashboard, isn't let in.
    expect(dockedFrameHost(src.replace('/app/', '/elsewhere/'), main)).toBeNull()
    expect(pulseFrameRequest(`#pulse=${encodeURIComponent(JSON.stringify({ host: 'https://b.example' }))}`)).toBeNull()
    expect(pulseFrameRequest(`#pulse=${encodeURIComponent(JSON.stringify({ docked: true }))}`)).toBeNull()
    expect(pulseFrameRequest('#pulse=%zz')).toBeNull()
    // A Pulse card's Do it carries its words; one from no chat asks for a new chat.
    const chat = { id: 'new-1', host: 'https://b.example', profile: 'ops', draft: 'Book it', fresh: true }
    expect(dockedChatRequest(dockedChatUrl(main, chat), main)).toEqual({ ...chat, docked: true })
  })

  it('titles a window by its chat, then its bot', () => {
    expect(chatWindowTitle('Trip plans', 'Nahida')).toBe('Trip plans — Nahida')
    // A Bot Chat goes by its bot's name alone.
    expect(chatWindowTitle('Nahida', 'Nahida')).toBe('Nahida')
    expect(chatWindowTitle('Trip plans')).toBe('Trip plans')
    expect(chatWindowTitle('  ', 'Nahida')).toBe('Nahida')
    expect(chatWindowTitle('')).toBe('Conduit')
  })
  it('docks another dashboard’s group chat, a room it hosts or its copy, at the main window’s own page only', () => {
    const main = 'file:///app/index.html'
    const src = dockedRoomUrl(main, { host: 'https://b.example', kind: 'copy', id: 'copy-1', title: 'Launch' })
    expect(roomFrameRequest(src.slice(main.length))).toEqual({ host: 'https://b.example', kind: 'copy', id: 'copy-1', title: 'Launch' })
    expect(dockedFrameHost(src, `${main}#chats`)).toBe('https://b.example')
    expect(dockedFrameHost(src.replace(main, 'https://evil.example/'), main)).toBeNull()
    const hash = (raw: object) => `#room=${encodeURIComponent(JSON.stringify(raw))}`
    expect(roomFrameRequest(hash({ host: 'https://b.example', kind: 'room', id: 'r1' }))).toBeNull()
    expect(roomFrameRequest(hash({ host: 'https://b.example', kind: 'other', id: 'r1', docked: true }))).toBeNull()
    expect(roomFrameRequest(hash({ host: 'https://b.example', kind: 'room', docked: true }))).toBeNull()
    expect(roomFrameRequest(hash({ host: 'https://b.example', kind: 'room', id: 'r1', docked: true }))).toEqual({ host: 'https://b.example', kind: 'room', id: 'r1' })
    expect(roomFrameRequest('#room=%zz')).toBeNull()
  })
})
