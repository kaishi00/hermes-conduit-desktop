/**
 * A chat's own notes (what a slash command printed, a /btw or /background
 * answer), which Hermes never stores, kept for the chat so a re-read or an
 * open draws them again (hermes-conduit issue 3394; the phone's
 * mergeLocalNotes). Each note remembers the stored row it followed and goes
 * back after it, or at the end when that row isn't drawn (or it came while
 * the chat wasn't on screen); the notes keep
 * their order either way. Kept per dashboard, profile and chat
 * (transcriptCache's keyOf), across launches.
 */
import type { OutputItem, TranscriptItem, TranscriptState } from './transcript'

export interface ChatNote {
  /** The note's item key, unique across launches (`note-…`). */
  key: string
  /** The stored row (`row-…`) it followed; null when it came before any, left out for a note that goes at the end. */
  after?: string | null
  command?: string
  text: string
  format: OutputItem['format']
}

const STORAGE_KEY = 'conduit.chatNotes.v1'
/** The most notes kept, and the most text they hold together: a /background answer can run long. */
export const MAX_CHAT_NOTES = 200
export const MAX_CHAT_NOTE_CHARS = 256 * 1024

let notes: Map<string, ChatNote[]> | null = null
/** The order chats last gained a note in, oldest first, for trimming. */
let order: string[] = []

function load(): Map<string, ChatNote[]> {
  if (notes) return notes
  notes = new Map()
  order = []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as [string, ChatNote[]][]) : []
    for (const [chat, list] of Array.isArray(parsed) ? parsed : []) {
      if (typeof chat === 'string' && Array.isArray(list)) {
        notes.set(chat, list)
        order.push(chat)
      }
    }
  } catch {
    // None kept.
  }
  return notes
}

function save(): void {
  const store = load()
  // Past either limit the oldest notes go, the chats that gained one longest ago first; the newest always stays.
  const all = order.flatMap(chat => (store.get(chat) ?? []).map(note => ({ chat, note })))
  let chars = all.reduce((sum, entry) => sum + entry.note.text.length, 0)
  let dropped = 0
  while (all.length - dropped > 1 && (all.length - dropped > MAX_CHAT_NOTES || chars > MAX_CHAT_NOTE_CHARS)) {
    chars -= all[dropped]!.note.text.length
    dropped++
  }
  store.clear()
  order = []
  for (const { chat, note } of all.slice(dropped)) {
    if (!store.has(chat)) {
      store.set(chat, [])
      order.push(chat)
    }
    store.get(chat)!.push(note)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order.map(chat => [chat, store.get(chat)])))
  } catch {
    // Kept for this launch only.
  }
}

function touch(chat: string): void {
  order = order.filter(key => key !== chat)
  order.push(chat)
}

const isRow = (item: TranscriptItem) => item.key.startsWith('row-')

/** The output items `state` draws, each with the stored row it follows. */
function notesIn(state: TranscriptState): ChatNote[] {
  const found: ChatNote[] = []
  let after: string | null = null
  for (const item of state.items) {
    if (item.kind === 'output') {
      found.push({ key: item.key, after, ...(item.command ? { command: item.command } : {}), text: item.text, format: item.format })
    } else if (isRow(item)) {
      after = item.key
    }
  }
  return found
}

/** Keeps the notes the chat draws now, with those it kept before that it doesn't draw. */
export function rememberChatNotes(chat: string, state: TranscriptState): void {
  const drawn = notesIn(state)
  if (!drawn.length) return
  const store = load()
  const kept = store.get(chat) ?? []
  const known = new Set(kept.map(note => note.key))
  const fresh = drawn.filter(note => !known.has(note.key))
  if (!fresh.length) return
  store.set(chat, [...kept, ...fresh])
  touch(chat)
  save()
}

/** A note for a chat that isn't on screen any more (a command that ended after the chat was left). */
export function addChatNote(chat: string, note: Omit<ChatNote, 'key' | 'after'>): void {
  const store = load()
  store.set(chat, [...(store.get(chat) ?? []), { key: newNoteKey(), ...note }])
  touch(chat)
  save()
}

/** The notes kept for a chat. */
export function chatNotes(chat: string): readonly ChatNote[] {
  return load().get(chat) ?? []
}

/** A note's item key: unique across launches, so a kept note is never taken for another. */
export function newNoteKey(): string {
  return `note-${crypto.randomUUID()}`
}

/**
 * `state` with the kept notes it doesn't draw put back: each after the row
 * it followed, or at the end when that row isn't drawn, never above a note
 * that came before it.
 */
export function withChatNotes(state: TranscriptState, kept: readonly ChatNote[]): TranscriptState {
  if (!kept.length) return state
  const drawn = new Set(state.items.map(item => item.key))
  const missing = kept.filter(note => !drawn.has(note.key))
  if (!missing.length) return state
  const at = new Map<string, number>()
  state.items.forEach((item, index) => at.set(item.key, index))
  // The notes by the item they go after: -1 is the top, items.length - 1 the end.
  const after = new Map<number, OutputItem[]>()
  let floor = -1
  for (const note of missing) {
    const end = state.items.length - 1
    const anchor = note.after === null ? -1 : note.after === undefined ? end : (at.get(note.after) ?? end)
    floor = Math.max(floor, anchor)
    const item: OutputItem = { kind: 'output', key: note.key, ...(note.command ? { command: note.command } : {}), text: note.text, format: note.format }
    after.set(floor, [...(after.get(floor) ?? []), item])
  }
  const items: TranscriptItem[] = [...(after.get(-1) ?? [])]
  state.items.forEach((item, index) => items.push(item, ...(after.get(index) ?? [])))
  return { ...state, items }
}

/** Forgets every kept note (tests). */
export function forgetChatNotes(): void {
  notes = new Map()
  order = []
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing kept.
  }
}
