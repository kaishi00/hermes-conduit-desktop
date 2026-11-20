/**
 * Conduit's keyboard shortcuts, after the phone's catalog: ⌘N New Chat, ⌘F
 * Search, ⌘. Stop, ⌘, Settings, ⌘1 to ⌘5 the sections, ⌘+ ⌘− ⌘0 the chat's
 * text size, ⌘\ the chat list and ⌘/ this list. The Mac's menu bar holds them there; Windows
 * has no menu bar, so the window reads Ctrl and the same key.
 */
import { t } from '../../../shared/i18n'
import type { MenuAction } from '../../../shared/ipc'

export type GoTo = 'bots' | 'chats' | 'tasks' | 'pulse' | 'needs'
/** ⌘1 to ⌘5, in the sidebar's order. */
export const GO_TO: GoTo[] = ['bots', 'chats', 'tasks', 'pulse', 'needs']

/** The key a shortcut takes, as KeyboardEvent.key; the first is the one shown. */
const KEYS: Partial<Record<MenuAction, string[]>> = {
  'new-chat': ['n'],
  search: ['f'],
  stop: ['.'],
  settings: [','],
  'text-bigger': ['+', '='],
  'text-smaller': ['-', '_'],
  'text-normal': ['0'],
  shortcuts: ['/', '?'],
  'toggle-sidebar': ['\\'],
  'go-1': ['1'],
  'go-2': ['2'],
  'go-3': ['3'],
  'go-4': ['4'],
  'go-5': ['5']
}

/** Ctrl (or ⌘ on a Mac, where the menu bar normally answers first) and a key, as the action it runs. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac: boolean): MenuAction | null {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!command || event.altKey) return null
  const key = event.key.toLowerCase()
  for (const [action, keys] of Object.entries(KEYS) as [MenuAction, string[]][]) {
    if (keys.includes(key)) return action
  }
  return null
}

/** "⌘N" on a Mac, "Ctrl+N" elsewhere. */
export function glyphs(action: MenuAction, mac: boolean): string {
  const key = KEYS[action]?.[0] ?? ''
  if (mac) return `⌘${key === '-' ? '−' : key.toUpperCase()}`
  return `Ctrl+${key === '+' ? 'Plus' : key === '-' ? 'Minus' : key.toUpperCase()}`
}

export function sectionTitle(section: GoTo): string {
  switch (section) {
    case 'bots':
      return t('Bots')
    case 'chats':
      return t('Chats')
    case 'tasks':
      return t('Tasks')
    case 'pulse':
      return t('Pulse')
    default:
      return t('Needs you')
  }
}

export interface ShortcutRow {
  title: string
  keys: string[]
}

/** The list ⌘/ opens, grouped as the phone's sheet is. */
export function shortcutGroups(mac: boolean): { title: string; rows: ShortcutRow[] }[] {
  const row = (title: string, action: MenuAction): ShortcutRow => ({ title, keys: [glyphs(action, mac)] })
  return [
    {
      title: t('Chats'),
      rows: [
        row(t('New Chat'), 'new-chat'),
        row(t('Search'), 'search'),
        { title: t('Send'), keys: [mac ? '↩' : 'Enter'] },
        { title: t('Stop'), keys: [glyphs('stop', mac), 'Esc'] },
        row(t('Show or Hide Sidebar'), 'toggle-sidebar')
      ]
    },
    {
      title: t('Go to'),
      rows: [...GO_TO.map((section, i) => row(sectionTitle(section), `go-${i + 1}` as MenuAction)), row(t('Settings'), 'settings')]
    },
    {
      title: t('Chat text size'),
      rows: [row(t('Make Text Bigger'), 'text-bigger'), row(t('Make Text Smaller'), 'text-smaller'), row(t('Make Text Normal Size'), 'text-normal')]
    },
    { title: '', rows: [row(t('Keyboard Shortcuts'), 'shortcuts')] }
  ]
}

const SCALE_KEY = 'conduit.chatTextScale'
/** The chat's text size steps, normal at 1. */
export const SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7]

export function nextScale(current: number, by: -1 | 0 | 1): number {
  if (by === 0) return 1
  const i = SCALES.findIndex(s => s >= current - 0.001)
  const at = i < 0 ? SCALES.length - 1 : i
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, at + by))]
}

export function readScale(): number {
  try {
    const value = Number(localStorage.getItem(SCALE_KEY))
    return SCALES.includes(value) ? value : 1
  } catch {
    return 1
  }
}

export function applyScale(scale: number): void {
  document.documentElement.style.setProperty('--chat-scale', String(scale))
  try {
    if (scale === 1) localStorage.removeItem(SCALE_KEY)
    else localStorage.setItem(SCALE_KEY, String(scale))
  } catch {
    // Normal size next time.
  }
}
