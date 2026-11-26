/**
 * The tabs over the chat column (issue 423): several chats kept open in the
 * main window, one shown, a click away from each other without a window of
 * their own. The shown tab follows the chat on screen, as a browser's tab
 * follows its page: a chat opened from the list, a pin or a notification
 * opens in the shown tab, or goes to its own tab when one holds it already.
 * Open in New Tab (and a middle or ⌘/Ctrl click on a row) gives a chat a tab
 * of its own beside the shown one.
 *
 * Built as the workspace's tab strip rather than a chat-only one: a tab has a
 * kind, and chats are the first. The coding workspace's tabs (terminals,
 * pages, a Git view; issues 450 to 453) join it as kinds of their own, so the
 * strip, its order and its keys stay as they are (Eric, 2026-11-25).
 */

/** A chat in a tab: an ordinary chat of any profile on this dashboard, or a new one (no id yet). */
export interface ChatTabTarget {
  id: string | null
  profile?: string
  title?: string
  /** A new chat's folder, from a project's New Chat. */
  folder?: string
}

export interface ChatTab {
  kind: 'chat'
  /** The tab's own key, kept while its chat changes (a new chat's id arriving, a chat opened in its place). */
  key: string
  chat: ChatTabTarget
}

/** Every kind of tab the strip holds; the coding workspace's kinds join this union. */
export type WorkspaceTab = ChatTab

export interface WorkspaceTabs {
  tabs: WorkspaceTab[]
  /** The shown tab's key; null while the chat column shows something no tab holds (a Bot Chat). */
  active: string | null
}

/** Past this many, a new tab closes the oldest one not shown. */
export const WORKSPACE_TAB_LIMIT = 12

export const NO_WORKSPACE_TABS: WorkspaceTabs = { tabs: [], active: null }

const profileOf = (profile?: string) => (profile ?? 'default').toLowerCase()

/** Whether `tab` holds `chat`: the same chat of the same profile. A new chat matches no other. */
export function holds(tab: WorkspaceTab, chat: Pick<ChatTabTarget, 'id' | 'profile'>): boolean {
  return tab.kind === 'chat' && chat.id !== null && tab.chat.id === chat.id && profileOf(tab.chat.profile) === profileOf(chat.profile)
}

export function tabHolding(tabs: WorkspaceTabs, chat: Pick<ChatTabTarget, 'id' | 'profile'>): WorkspaceTab | undefined {
  return tabs.tabs.find(tab => holds(tab, chat))
}

/** What the chat column opens for a tab. */
export function tabTarget(tab: WorkspaceTab): ChatTabTarget {
  const { id, profile, title, folder } = tab.chat
  return { id, profile, title, ...(folder ? { folder } : {}) }
}

export function activeTab(tabs: WorkspaceTabs): WorkspaceTab | undefined {
  return tabs.active === null ? undefined : tabs.tabs.find(tab => tab.key === tabs.active)
}

function limited(tabs: WorkspaceTab[], keep: string): WorkspaceTab[] {
  let next = tabs
  while (next.length > WORKSPACE_TAB_LIMIT) {
    const oldest = next.findIndex(tab => tab.key !== keep)
    if (oldest < 0) break
    next = next.filter((_, i) => i !== oldest)
  }
  return next
}

const sameTarget = (a: ChatTabTarget, b: ChatTabTarget) =>
  a.id === b.id && profileOf(a.profile) === profileOf(b.profile) && a.title === b.title && a.folder === b.folder

/**
 * The chat column now shows `chat`: its own tab shows when one holds it;
 * otherwise the shown tab now holds it (a new chat's id arriving lands here
 * too), and with no tab shown it gets a tab of its own after the others.
 * `key` names that new tab.
 */
export function followChat(tabs: WorkspaceTabs, chat: ChatTabTarget, key: string): WorkspaceTabs {
  const own = tabHolding(tabs, chat)
  if (own) {
    const title = chat.title ?? own.chat.title
    if (tabs.active === own.key && title === own.chat.title) return tabs
    return {
      tabs: title === own.chat.title ? tabs.tabs : tabs.tabs.map(tab => (tab.key === own.key ? { ...tab, chat: { ...tab.chat, title } } : tab)),
      active: own.key
    }
  }
  const shown = activeTab(tabs)
  if (shown) {
    if (sameTarget(shown.chat, chat)) return tabs
    return { tabs: tabs.tabs.map(tab => (tab.key === shown.key ? { ...tab, chat } : tab)), active: shown.key }
  }
  return { tabs: limited([...tabs.tabs, { kind: 'chat', key, chat }], key), active: key }
}

/**
 * Open in New Tab: `chat` in a tab of its own right after the shown one, and
 * shown; its own tab when one holds it already. The chat on screen keeps its
 * tab, which starts the strip when there wasn't one: `current` is that chat.
 */
export function openInNewTab(tabs: WorkspaceTabs, chat: ChatTabTarget, key: string, current?: { chat: ChatTabTarget; key: string }): WorkspaceTabs {
  const own = tabHolding(tabs, chat)
  if (own) return { ...tabs, active: own.key }
  let base = tabs
  if (!activeTab(base) && current) base = followChat(base, current.chat, current.key)
  const at = base.active === null ? -1 : base.tabs.findIndex(tab => tab.key === base.active)
  const added: WorkspaceTab = { kind: 'chat', key, chat }
  const next = at < 0 ? [...base.tabs, added] : [...base.tabs.slice(0, at + 1), added, ...base.tabs.slice(at + 1)]
  return { tabs: limited(next, key), active: key }
}

/** The tab shown after `key`'s closes: the one after it, else the one before. */
function neighbour(tabs: WorkspaceTab[], at: number): WorkspaceTab | undefined {
  return tabs[at + 1] ?? tabs[at - 1]
}

/**
 * Closes `key`'s tab. When it was shown, `show` is the tab to show in its
 * place (the one after it, else the one before), whose chat the column opens.
 */
export function closeWorkspaceTab(tabs: WorkspaceTabs, key: string): { tabs: WorkspaceTabs; show?: WorkspaceTab } {
  const at = tabs.tabs.findIndex(tab => tab.key === key)
  if (at < 0) return { tabs }
  const rest = tabs.tabs.filter((_, i) => i !== at)
  if (tabs.active !== key) return { tabs: { tabs: rest, active: tabs.active } }
  const show = neighbour(tabs.tabs, at)
  return { tabs: { tabs: rest, active: show?.key ?? null }, show }
}

/**
 * A chat that can't stay in a tab (deleted, or moved to a window of its own,
 * which is the only place it shows): its tab closes, and `show` is the tab
 * shown in its place when it was the shown one.
 */
export function dropChatTabs(tabs: WorkspaceTabs, chat: Pick<ChatTabTarget, 'id' | 'profile'>): { tabs: WorkspaceTabs; show?: WorkspaceTab } {
  const own = tabHolding(tabs, chat)
  return own ? closeWorkspaceTab(tabs, own.key) : { tabs }
}

/** Ctrl+Tab and Ctrl+Shift+Tab: the tab after the shown one, or before it, round the strip. */
export function stepTab(tabs: WorkspaceTabs, by: 1 | -1): WorkspaceTab | undefined {
  if (tabs.tabs.length < 2) return undefined
  const at = tabs.tabs.findIndex(tab => tab.key === tabs.active)
  if (at < 0) return tabs.tabs[by > 0 ? 0 : tabs.tabs.length - 1]
  return tabs.tabs[(at + by + tabs.tabs.length) % tabs.tabs.length]
}

/** The strip shows once two tabs are open: one tab is the chat column as it always was. */
export const showsTabStrip = (tabs: WorkspaceTabs) => tabs.tabs.length > 1

/** A middle click, or a click with ⌘ (a Mac) or Ctrl (elsewhere), opens a chat's row in a tab of its own, as a browser's link does. */
export function opensInTab(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey'>, mac = globalThis.window?.conduit?.platform === 'darwin'): boolean {
  return e.button === 1 || (e.button === 0 && (mac ? e.metaKey : e.ctrlKey))
}
