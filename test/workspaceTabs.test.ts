import { describe, expect, it } from 'vitest'
import {
  NO_WORKSPACE_TABS,
  WORKSPACE_TAB_LIMIT,
  closeWorkspaceTab,
  dropChatTabs,
  followChat,
  openInNewTab,
  showsTabStrip,
  stepTab,
  tabTarget,
  type WorkspaceTabs
} from '../src/renderer/src/state/workspaceTabs'

const chat = (id: string | null, profile?: string) => ({ id, profile, title: id ?? undefined })
const ids = (tabs: WorkspaceTabs) => tabs.tabs.map(tab => tab.chat.id)
const shown = (tabs: WorkspaceTabs) => tabs.tabs.find(tab => tab.key === tabs.active)?.chat.id

let n = 0
const key = () => `k${++n}`

describe('the tabs over the chat column', () => {
  it('starts with one tab for the chat on screen, and no strip until a second', () => {
    const tabs = followChat(NO_WORKSPACE_TABS, chat('a'), key())
    expect(ids(tabs)).toEqual(['a'])
    expect(showsTabStrip(tabs)).toBe(false)
  })

  it('opens a chat from the list in the shown tab, as a browser tab follows its page', () => {
    const tabs = followChat(followChat(NO_WORKSPACE_TABS, chat('a'), key()), chat('b'), key())
    expect(ids(tabs)).toEqual(['b'])
  })

  it('opens a chat in a tab of its own beside the shown one, and shows it', () => {
    let tabs = followChat(NO_WORKSPACE_TABS, chat('a'), key())
    tabs = openInNewTab(tabs, chat('b'), key())
    tabs = followChat(tabs, chat('b'), key())
    expect(ids(tabs)).toEqual(['a', 'b'])
    expect(shown(tabs)).toBe('b')
    expect(showsTabStrip(tabs)).toBe(true)
    // Right after the shown tab, not at the end.
    tabs = followChat(tabs, chat('a'), key())
    tabs = openInNewTab(tabs, chat('c'), key())
    expect(ids(tabs)).toEqual(['a', 'c', 'b'])
  })

  it('goes to a chat’s own tab when one holds it, from the list or Open in New Tab', () => {
    let tabs = openInNewTab(followChat(NO_WORKSPACE_TABS, chat('a'), key()), chat('b'), key())
    tabs = followChat(tabs, chat('a'), key())
    expect(ids(tabs)).toEqual(['a', 'b'])
    expect(shown(tabs)).toBe('a')
    tabs = openInNewTab(tabs, chat('b'), key())
    expect(ids(tabs)).toEqual(['a', 'b'])
    expect(shown(tabs)).toBe('b')
  })

  it('tells chats of different bots apart, and new chats from each other', () => {
    let tabs = openInNewTab(followChat(NO_WORKSPACE_TABS, chat('a', 'coder'), key()), chat('a', 'writer'), key())
    expect(tabs.tabs).toHaveLength(2)
    tabs = followChat(tabs, chat('a', 'Coder'), key())
    expect(tabs.tabs[0]!.key).toBe(tabs.active)
    tabs = openInNewTab(tabs, chat(null), key())
    tabs = openInNewTab(tabs, chat(null), key())
    expect(tabs.tabs).toHaveLength(4)
  })

  it('keeps a new chat’s tab when its id arrives', () => {
    let tabs = openInNewTab(followChat(NO_WORKSPACE_TABS, chat('a'), key()), chat(null), key())
    const tab = tabs.active
    tabs = followChat(tabs, chat('n1'), key())
    expect(ids(tabs)).toEqual(['a', 'n1'])
    expect(tabs.active).toBe(tab)
  })

  it('shows a new chat’s tab when it’s picked, never the shown tab taking a second new chat', () => {
    // Chat a, then + (a new chat's tab), then back to a, then the new chat's tab picked: the window shows that tab
    // by its key and opens its new chat, as App's showTab does.
    let tabs = followChat(NO_WORKSPACE_TABS, chat('a'), key())
    tabs = openInNewTab(tabs, chat(null), key())
    const draft = tabs.active!
    tabs = followChat(tabs, chat('a'), key())
    tabs = followChat({ ...tabs, active: draft }, tabTarget(tabs.tabs.find(tab => tab.key === draft)!), key())
    expect(ids(tabs)).toEqual(['a', null])
    expect(tabs.active).toBe(draft)
  })

  it('leaves the tabs be while a Bot Chat shows, and the strip starts from the chat on screen', () => {
    const tabs = openInNewTab({ tabs: [], active: null }, chat('b'), key(), { chat: chat('a'), key: key() })
    expect(ids(tabs)).toEqual(['a', 'b'])
  })

  it('closing the shown tab shows the one after it, else the one before', () => {
    let tabs = followChat(NO_WORKSPACE_TABS, chat('a'), key())
    tabs = openInNewTab(tabs, chat('b'), key())
    tabs = openInNewTab(tabs, chat('c'), key())
    tabs = followChat(tabs, chat('b'), key())
    let closed = closeWorkspaceTab(tabs, tabs.active!)
    expect(ids(closed.tabs)).toEqual(['a', 'c'])
    expect(closed.show?.chat.id).toBe('c')
    expect(shown(closed.tabs)).toBe('c')
    closed = closeWorkspaceTab(closed.tabs, closed.tabs.active!)
    expect(closed.show?.chat.id).toBe('a')
    // A tab not shown closes alone.
    closed = closeWorkspaceTab(tabs, tabs.tabs[0]!.key)
    expect(closed.show).toBeUndefined()
    expect(shown(closed.tabs)).toBe('b')
  })

  it('closes a deleted chat’s tab, or one moved to a window of its own', () => {
    const tabs = openInNewTab(followChat(NO_WORKSPACE_TABS, chat('a'), key()), chat('b'), key())
    const dropped = dropChatTabs(tabs, chat('b'))
    expect(ids(dropped.tabs)).toEqual(['a'])
    expect(dropped.show?.chat.id).toBe('a')
    expect(dropChatTabs(tabs, chat('z')).tabs).toBe(tabs)
  })

  it('steps round the strip with Ctrl+Tab and Ctrl+Shift+Tab', () => {
    let tabs = followChat(NO_WORKSPACE_TABS, chat('a'), key())
    expect(stepTab(tabs, 1)).toBeUndefined()
    tabs = openInNewTab(openInNewTab(tabs, chat('b'), key()), chat('c'), key())
    expect(stepTab(tabs, 1)?.chat.id).toBe('a')
    expect(stepTab(tabs, -1)?.chat.id).toBe('b')
  })

  it('past the limit closes the oldest tab, never the shown one', () => {
    let tabs = followChat(NO_WORKSPACE_TABS, chat('0'), key())
    for (let i = 1; i <= WORKSPACE_TAB_LIMIT; i++) tabs = openInNewTab(tabs, chat(String(i)), key())
    expect(tabs.tabs).toHaveLength(WORKSPACE_TAB_LIMIT)
    expect(ids(tabs)[0]).toBe('1')
    expect(shown(tabs)).toBe(String(WORKSPACE_TAB_LIMIT))
  })
})

describe('a New Chat’s tab (#656 review)', () => {
  it('keeps the draft it holds, so showing it again opens the same draft', () => {
    let tabs = openInNewTab(followChat(NO_WORKSPACE_TABS, chat('a'), key()), { id: null, profile: 'work' }, key())
    tabs = followChat(tabs, { id: null, profile: 'work', draft: 3 }, key())
    const draftTab = tabs.tabs.find(tab => tab.key === tabs.active)!
    expect(tabTarget(draftTab)).toEqual({ id: null, profile: 'work', title: undefined, draft: 3 })
  })

  it('drops the draft once the chat is saved', () => {
    const tabs = followChat(followChat(NO_WORKSPACE_TABS, { id: null, draft: 3 }, key()), { id: 's1', draft: 3 }, key())
    expect(tabTarget(tabs.tabs[0])).toEqual({ id: 's1', profile: undefined, title: undefined })
  })
})
