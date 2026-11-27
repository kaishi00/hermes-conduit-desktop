/**
 * Which chats' windows are kept on top (issue 608): a chat window's pin keeps
 * it in front of every other window, other apps' too, until it's turned off,
 * and the chat's window opens kept on top the next time. Kept in
 * chat-windows-on-top.json in the data folder.
 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import { withKeptOnTop } from '../shared/chatWindows'

const path = () => join(app.getPath('userData'), 'chat-windows-on-top.json')

let keys: string[] | null = null

function load(): string[] {
  if (keys) return keys
  keys = []
  try {
    const stored = JSON.parse(readFileSync(path(), 'utf8')) as unknown
    if (Array.isArray(stored)) keys = stored.filter((key): key is string => typeof key === 'string')
  } catch {
    // None yet, or unreadable: no window is kept on top.
  }
  return keys
}

export function keptOnTop(key: string): boolean {
  return load().includes(key)
}

export function keepOnTop(key: string, on: boolean): void {
  const next = withKeptOnTop(load(), key, on)
  keys = next
  try {
    writeFileAtomic(path(), JSON.stringify(next))
  } catch {
    // Not saved: this window stays as chosen, and the next open forgets it.
  }
}
