// @vitest-environment happy-dom
/// <reference lib="es2024.promise" />
import { act, createElement, Fragment, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_LIST_MAX_PAGES, CHAT_LIST_PAGE, chatListPath, type ChatRow } from '../src/renderer/src/state/chats'
import { dismissAllDialogs } from '../src/renderer/src/state/dialogs'
import { setLanguage } from '../src/shared/i18n'
import { settle } from './hookHarness'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => http(...args) }
}))

type Props = {
  host: string
  profile: string | null
  visibleVoiceIds?: ReadonlySet<string>
  onClose: () => void
  onRestore: (row: ChatRow) => Promise<boolean>
  onDelete: (row: ChatRow) => Promise<boolean>
}
let ArchivedChats: ComponentType<Props>
let DialogHost: ComponentType
const mounted: { root: Root; host: HTMLElement }[] = []
const rawRow = (id: string, title: string, profile = 'default', extra: Record<string, unknown> = {}) => ({ id, title, profile, ...extra })
const excluded = (n: number) => Array.from({ length: n }, (_, i) => rawRow(`cron-${i}`, 'Cron', 'default', { source: 'cron' }))

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    host: 'https://first.example',
    profile: null,
    onClose: vi.fn(),
    onRestore: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
    ...overrides
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  const draw = (changes: Partial<Props> = {}) => {
    Object.assign(props, changes)
    act(() => root.render(createElement(Fragment, null, createElement(ArchivedChats, props), createElement(DialogHost))))
  }
  draw()
  return { host, root, props, draw }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label)
  if (!found) throw new Error(`No button named ${label}`)
  return found
}

function search(host: HTMLElement, value: string) {
  const input = host.querySelector('input')!
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeAll(async () => {
  // The node test tsconfig has no JSX; resolve renderer components the same way as the other render tests.
  const component = '../src/renderer/src/components/ArchivedChats.tsx'
  const dialogs = '../src/renderer/src/components/Dialogs.tsx'
  ;({ ArchivedChats } = (await import(/* @vite-ignore */ component)) as { ArchivedChats: ComponentType<Props> })
  ;({ DialogHost } = (await import(/* @vite-ignore */ dialogs)) as { DialogHost: ComponentType })
})

beforeEach(() => {
  http.mockReset()
  setLanguage('en')
})

afterEach(() => {
  act(() => {
    for (const { root, host } of mounted.splice(0)) {
      root.unmount()
      host.remove()
    }
    dismissAllDialogs()
  })
  setLanguage('en')
})

describe('Archived chats', () => {
  it('classifies archived rows with fresh voice tags', async () => {
    const first = [rawRow('manual', 'Manual chat', 'Work'), ...excluded(CHAT_LIST_PAGE - 1)]
    const second = [
      rawRow('sweep', 'Automatic non-voice', 'Work', { auto_archived: 1 }),
      rawRow('call', 'Saved voice call', 'Work', { auto_archived: true, end_reason: 'conduit_voice' }),
      rawRow('classic', 'Classic voice', 'Work', { auto_archived: true }),
      rawRow('other', 'Other profile', 'default')
    ]
    const fresh = Promise.withResolvers<unknown>()
    http.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/plugins/conduit_push/voice/tags')) return fresh.promise
      return Promise.resolve({ sessions: path === chatListPath(0, 'only') ? first : second })
    })
    const sheet = render({ visibleVoiceIds: new Set(['call', 'classic']) })
    await settle()
    expect(http.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['GET', chatListPath(0, 'only')],
      ['GET', chatListPath(CHAT_LIST_PAGE, 'only')],
      ['GET', '/api/plugins/conduit_push/voice/tags?profile=Work']
    ])
    expect(sheet.host.textContent).toContain('Manual chat')
    expect(sheet.host.textContent).toContain('Automatic non-voice')
    expect(sheet.host.textContent).toContain('Classic voice')
    expect(sheet.host.textContent).toContain('Other profile')
    expect(sheet.host.textContent).not.toContain('Saved voice call')
    expect(button(sheet.host, 'Restore: Manual chat').disabled).toBe(false)
    expect(button(sheet.host, 'Restore: Automatic non-voice').disabled).toBe(true)
    expect(button(sheet.host, 'Delete: Classic voice').disabled).toBe(true)
    expect(sheet.host.textContent).toContain('Voice tags are unavailable.')
    act(() => button(sheet.host, 'Restore: Automatic non-voice').click())
    expect(sheet.props.onRestore).not.toHaveBeenCalled()
    await act(async () => { fresh.resolve({ tags: { classic: { kind: 'classic' } } }) })
    sheet.draw({ profile: 'WORK' })
    expect(sheet.host.textContent).toContain('Manual chat')
    expect(sheet.host.textContent).toContain('Automatic non-voice')
    expect(sheet.host.textContent).not.toContain('Classic voice')
    expect(button(sheet.host, 'Restore: Automatic non-voice').disabled).toBe(false)
    expect(button(sheet.host, 'Delete: Automatic non-voice').disabled).toBe(false)
    expect(sheet.host.textContent).not.toContain('Voice tags are unavailable.')
    expect(sheet.host.textContent).not.toContain('Other profile')
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('keeps older voice rows available when they are not in the live list', async () => {
    http.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/plugins/conduit_push/voice/tags?profile=work') return { tags: { visible: { kind: 'classic' }, older: { kind: 'classic' } } }
      if (path === '/api/plugins/conduit_push/voice/tags?profile=home') return { tags: {} }
      return { sessions: [
        rawRow('visible', 'Live voice', 'work', { auto_archived: true }),
        rawRow('older', 'Older classic voice', 'work', { auto_archived: true }),
        rawRow('old-call', 'Older call', 'home', { auto_archived: true, end_reason: 'conduit_voice' })
      ] }
    })
    const { host } = render({ visibleVoiceIds: new Set(['visible']) })
    await settle()
    expect(host.textContent).not.toContain('Live voice')
    expect(button(host, 'Restore: Older classic voice').disabled).toBe(false)
    expect(button(host, 'Delete: Older call').disabled).toBe(false)
  })

  it('keeps actions disabled after a tag read fails, and retries that profile', async () => {
    let reads = 0
    http.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/api/plugins/conduit_push/voice/tags')) {
        if (++reads === 1) throw new Error('offline')
        return { tags: {} }
      }
      return { sessions: [rawRow('one', 'A swept chat', 'work', { auto_archived: true })] }
    })
    const remove = vi.fn().mockResolvedValue(true)
    const sheet = render({ onDelete: remove })
    await settle()
    expect(button(sheet.host, 'Delete: A swept chat').disabled).toBe(true)
    expect(sheet.host.textContent).toContain('Voice tags are unavailable.')
    act(() => button(sheet.host, 'Retry').click())
    await settle()
    expect(reads).toBe(2)
    expect(button(sheet.host, 'Delete: A swept chat').disabled).toBe(false)
    act(() => button(sheet.host, 'Delete: A swept chat').click())
    act(() => button(sheet.host, 'Delete').click())
    await settle()
    expect(remove).toHaveBeenCalledOnce()
    expect(sheet.host.textContent).not.toContain('A swept chat')
  })

  it('ignores an old host’s voice tags after a host switch', async () => {
    const oldTags = Promise.withResolvers<unknown>()
    let lists = 0
    let tags = 0
    http.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/plugins/conduit_push/voice/tags')) return ++tags === 1 ? oldTags.promise : Promise.resolve({ tags: {} })
      return Promise.resolve({ sessions: [rawRow('same', ++lists === 1 ? 'Old host' : 'New host', 'work', { auto_archived: true })] })
    })
    const sheet = render({ visibleVoiceIds: new Set(['same']) })
    await settle()
    expect(button(sheet.host, 'Restore: Old host').disabled).toBe(true)
    sheet.draw({ host: 'https://second.example' })
    await settle()
    expect(button(sheet.host, 'Restore: New host').disabled).toBe(false)
    await act(async () => { oldTags.resolve({ tags: { same: { kind: 'classic' } } }) })
    expect(button(sheet.host, 'Restore: New host').disabled).toBe(false)
    expect(sheet.host.textContent).not.toContain('Old host')
  })

  it('follows short pages using snake-case and camel-case offsets, and falls back to the total', async () => {
    http
      .mockResolvedValueOnce({ sessions: [rawRow('one', 'First')], has_more: true, next_offset: 7 })
      .mockResolvedValueOnce({ sessions: [rawRow('two', 'Second')], hasMore: true, nextOffset: '9' })
      .mockResolvedValueOnce({ sessions: [rawRow('three', 'Third')], total: 11 })
      .mockResolvedValueOnce({ sessions: [rawRow('four', 'Fourth')], has_more: false, total: 11 })
    const { host } = render()
    await settle()
    expect(http.mock.calls.map(call => call[1])).toEqual([0, 7, 9, 10].map(offset => chatListPath(offset, 'only')))
    for (const title of ['First', 'Second', 'Third', 'Fourth']) expect(host.textContent).toContain(title)
    expect(host.textContent).not.toContain('Loading chats…')
  })

  it('makes progress on a non-advancing offset and stops on an empty page even when more is claimed', async () => {
    http
      .mockResolvedValueOnce({ sessions: [rawRow('one', 'First')], has_more: true, next_offset: 0 })
      .mockResolvedValueOnce({ sessions: [], hasMore: true, nextOffset: 10 })
    const { host } = render()
    await settle()
    expect(http.mock.calls.map(call => call[1])).toEqual([chatListPath(0, 'only'), chatListPath(1, 'only')])
    expect(host.textContent).toContain('First')
    expect(host.textContent).not.toContain('Loading chats…')
    expect(host.textContent).not.toContain('Show More')
  })

  it('searches the title, session ID, source, model and profile, ignoring case', async () => {
    http.mockResolvedValue({ sessions: [
      rawRow('session-unique', 'Morning notes', 'Work', { source: 'telegram', model: 'provider/special-model' }),
      rawRow('second', 'Evening notes', 'default')
    ] })
    const { host } = render()
    await settle()
    for (const query of ['MORNING', 'SESSION-UNIQUE', 'TELEGRAM', 'SPECIAL-MODEL', 'WORK']) {
      search(host, query)
      expect(host.textContent).toContain('Morning notes')
      expect(host.textContent).not.toContain('Evening notes')
    }
    search(host, 'not found')
    expect(host.textContent).toContain('No matching conversations')
    search(host, '')
    expect(host.textContent).toContain('Evening notes')
  })

  it('shows loading, an empty list, and its close action', async () => {
    const response = Promise.withResolvers<unknown>()
    http.mockReturnValue(response.promise)
    const { host, props } = render()
    expect(host.textContent).toContain('Loading chats…')
    await act(async () => { response.resolve({ sessions: [] }) })
    expect(host.textContent).toContain('No archived chats.')
    expect(host.textContent).not.toContain('Loading chats…')
    act(() => button(host, 'Done').click())
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('keeps earlier rows when a later page fails, and retries the failed offset', async () => {
    const first = [rawRow('one', 'First chat'), ...excluded(CHAT_LIST_PAGE - 1)]
    http.mockResolvedValueOnce({ sessions: first }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ sessions: [rawRow('two', 'Second chat')] })
    const { host } = render()
    await settle()
    expect(host.textContent).toContain('First chat')
    expect(host.textContent).toContain('Could not load archived chats.')
    expect(host.textContent).toContain('offline')
    act(() => button(host, 'Retry').click())
    await settle()
    expect(http.mock.calls[2]?.[1]).toBe(chatListPath(CHAT_LIST_PAGE, 'only'))
    expect(host.textContent).toContain('First chat')
    expect(host.textContent).toContain('Second chat')
    expect(host.textContent).not.toContain('Could not load archived chats.')
  })

  it('warns when a profile cannot be read and retries rather than claiming the archive is empty', async () => {
    http.mockResolvedValueOnce({ sessions: [], errors: [{ profile: 'work', error: 'locked' }] }).mockResolvedValueOnce({ sessions: [rawRow('one', 'Recovered', 'work')] })
    const { host } = render()
    await settle()
    expect(host.textContent).toContain('Hermes couldn’t read work’s chats: locked')
    expect(host.textContent).not.toContain('No archived chats.')
    act(() => button(host, 'Retry').click())
    await settle()
    expect(host.textContent).toContain('Recovered')
    expect(host.textContent).not.toContain('locked')
  })

  it('offers another batch after the page limit, even if every preceding row was filtered out', async () => {
    const full = excluded(CHAT_LIST_PAGE)
    http.mockImplementation(async (_method: string, path: string) => {
      const offset = Number(new URL(path, 'https://first.example').searchParams.get('offset'))
      return { sessions: offset < CHAT_LIST_MAX_PAGES * CHAT_LIST_PAGE ? full : [rawRow('last', 'Beyond the limit')] }
    })
    const { host } = render()
    await act(async () => { for (let i = 0; i < 100; i++) await Promise.resolve() })
    expect(http).toHaveBeenCalledTimes(CHAT_LIST_MAX_PAGES)
    expect(host.textContent).not.toContain('No archived chats.')
    act(() => button(host, 'Show More').click())
    await settle()
    expect(http.mock.calls.at(-1)?.[1]).toBe(chatListPath(CHAT_LIST_MAX_PAGES * CHAT_LIST_PAGE, 'only'))
    expect(host.textContent).toContain('Beyond the limit')
  })

  it('disables both actions while restoring, keeps failures visible, and removes only on success', async () => {
    http.mockResolvedValue({ sessions: [rawRow('one', 'A chat', 'work')] })
    const result = Promise.withResolvers<boolean>()
    const restore = vi.fn().mockReturnValueOnce(result.promise).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)
    const { host } = render({ onRestore: restore })
    await settle()
    act(() => button(host, 'Restore: A chat').click())
    expect(button(host, 'Restore: A chat').disabled).toBe(true)
    expect(button(host, 'Delete: A chat').disabled).toBe(true)
    act(() => button(host, 'Restore: A chat').click())
    expect(restore).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'one', profile: 'work', title: 'A chat' }))
    await act(async () => { result.resolve(false) })
    expect(host.textContent).toContain('Could not restore this chat.')
    expect(host.textContent).toContain('A chat')
    act(() => button(host, 'Restore: A chat').click())
    await settle()
    expect(host.textContent).toContain('Could not restore this chat.')
    expect(host.textContent).toContain('A chat')
    act(() => button(host, 'Restore: A chat').click())
    await settle()
    expect(host.textContent).not.toContain('A chat')
    expect(host.textContent).toContain('No archived chats.')
  })

  it('restarts an unfinished read after a restore shifts the server offsets', async () => {
    const oldPage = Promise.withResolvers<unknown>()
    http
      .mockResolvedValueOnce({ sessions: [rawRow('gone', 'Restore me'), ...excluded(CHAT_LIST_PAGE - 1)] })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ sessions: [rawRow('survivor', 'Remaining chat'), ...excluded(CHAT_LIST_PAGE - 1)] })
      .mockResolvedValueOnce({ sessions: [rawRow('older', 'Older chat')] })
    const { host } = render()
    await settle()
    act(() => button(host, 'Restore: Restore me').click())
    await settle()
    expect(http.mock.calls.map(call => call[1])).toEqual([
      chatListPath(0, 'only'),
      chatListPath(CHAT_LIST_PAGE, 'only'),
      chatListPath(0, 'only'),
      chatListPath(CHAT_LIST_PAGE, 'only')
    ])
    expect(host.textContent).toContain('Remaining chat')
    expect(host.textContent).toContain('Older chat')
    await act(async () => { oldPage.resolve({ sessions: [rawRow('stale', 'Stale page')] }) })
    expect(host.textContent).not.toContain('Stale page')
    expect(host.textContent).not.toContain('Restore me')
  })

  it('requires an explicit destructive confirmation, leaves failed deletions visible, and deletes on success', async () => {
    http.mockResolvedValue({ sessions: [rawRow('one', 'A chat', 'work')] })
    const remove = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { host } = render({ onDelete: remove })
    await settle()
    act(() => button(host, 'Delete: A chat').click())
    expect(host.querySelector('.conduit-dialog')?.textContent).toContain('This permanently deletes the conversation and cannot be undone.')
    act(() => button(host, 'Cancel').click())
    await settle()
    expect(remove).not.toHaveBeenCalled()
    expect(host.textContent).toContain('A chat')
    act(() => button(host, 'Delete: A chat').click())
    act(() => button(host, 'Delete').click())
    await settle()
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'one', profile: 'work' }))
    expect(host.textContent).toContain('Could not delete this chat.')
    act(() => button(host, 'Delete: A chat').click())
    act(() => button(host, 'Delete').click())
    await settle()
    expect(host.textContent).not.toContain('A chat')
    expect(host.textContent).toContain('No archived chats.')
  })

  it('does not allow a stale read or restore to affect a newly selected host', async () => {
    const oldRead = Promise.withResolvers<unknown>()
    http.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce({ sessions: [rawRow('same', 'New host chat')] })
    const sheet = render()
    sheet.draw({ host: 'https://second.example' })
    await settle()
    await act(async () => { oldRead.resolve({ sessions: [rawRow('old', 'Old host chat'), ...excluded(CHAT_LIST_PAGE - 1)] }) })
    expect(sheet.host.textContent).toContain('New host chat')
    expect(sheet.host.textContent).not.toContain('Old host chat')
    expect(http).toHaveBeenCalledTimes(2)

    const pending = Promise.withResolvers<boolean>()
    const restore = vi.fn().mockReturnValue(pending.promise)
    sheet.draw({ onRestore: restore })
    act(() => button(sheet.host, 'Restore: New host chat').click())
    http.mockResolvedValueOnce({ sessions: [rawRow('same', 'Third host chat')] })
    sheet.draw({ host: 'https://third.example' })
    await settle()
    await act(async () => { pending.resolve(true) })
    expect(sheet.host.textContent).toContain('Third host chat')
    expect(button(sheet.host, 'Restore: Third host chat').disabled).toBe(false)
  })

  it('closes a delete confirmation when the host changes, and never starts that delete', async () => {
    http.mockResolvedValueOnce({ sessions: [rawRow('one', 'Old chat')] }).mockResolvedValueOnce({ sessions: [rawRow('one', 'New chat')] })
    const remove = vi.fn().mockResolvedValue(true)
    const sheet = render({ onDelete: remove })
    await settle()
    act(() => button(sheet.host, 'Delete: Old chat').click())
    expect(sheet.host.querySelector('.conduit-dialog')).not.toBeNull()
    sheet.draw({ host: 'https://second.example' })
    await settle()
    // The question was about the old dashboard's chat: it goes with it (#415).
    expect(sheet.host.querySelector('.conduit-dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
    expect(sheet.host.textContent).toContain('New chat')
    expect(button(sheet.host, 'Delete: New chat').disabled).toBe(false)
  })

  it('closes a delete confirmation when the sheet unmounts under it', async () => {
    http.mockResolvedValue({ sessions: [rawRow('one', 'A chat')] })
    const remove = vi.fn().mockResolvedValue(true)
    const dialogHost = document.createElement('div')
    document.body.appendChild(dialogHost)
    const dialogRoot = createRoot(dialogHost)
    mounted.push({ root: dialogRoot, host: dialogHost })
    act(() => dialogRoot.render(createElement(DialogHost)))
    // The sheet alone, as the app draws it: the dialog host lives above it and outlives it.
    const sheetHost = document.createElement('div')
    document.body.appendChild(sheetHost)
    const sheetRoot = createRoot(sheetHost)
    act(() =>
      sheetRoot.render(
        createElement(ArchivedChats, {
          host: 'https://first.example',
          profile: null,
          onClose: () => undefined,
          onRestore: async () => true,
          onDelete: remove
        } as Props)
      )
    )
    await settle()
    act(() => button(sheetHost, 'Delete: A chat').click())
    expect(dialogHost.querySelector('.conduit-dialog')).not.toBeNull()
    // A section shortcut or a dropped connection takes the sheet away with the question still up.
    act(() => sheetRoot.unmount())
    sheetHost.remove()
    await settle()
    expect(dialogHost.querySelector('.conduit-dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })

  it('stops a page read after the sheet is unmounted', async () => {
    const response = Promise.withResolvers<unknown>()
    http.mockReturnValue(response.promise)
    const sheet = render()
    act(() => sheet.root.unmount())
    mounted.splice(mounted.findIndex(item => item.root === sheet.root), 1)
    sheet.host.remove()
    await act(async () => { response.resolve({ sessions: excluded(CHAT_LIST_PAGE) }) })
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('drops live pinned backfill rows returned by archived=only', async () => {
    http.mockResolvedValueOnce({
      sessions: [
        rawRow('live-pin', 'Live pinned chat', 'default', { archived: false, pinned: true }),
        rawRow('live-pin-num', 'Live pinned numeric', 'default', { archived: 0, pinned: 1 })
      ],
      total: 0
    })
    const empty = render()
    await settle()
    expect(empty.host.textContent).not.toContain('Live pinned chat')
    expect(empty.host.textContent).not.toContain('Live pinned numeric')
    expect(empty.host.textContent).toContain('No archived chats.')
    expect(http).toHaveBeenCalledTimes(1)

    http.mockResolvedValueOnce({
      sessions: [
        rawRow('arch-1', 'Archived one', 'default', { archived: true }),
        rawRow('live-pin', 'Live pinned chat', 'default', { archived: false, pinned: true })
      ],
      total: 1
    })
    const mixed = render({ host: 'https://second.example' })
    await settle()
    expect(mixed.host.textContent).toContain('Archived one')
    expect(mixed.host.textContent).not.toContain('Live pinned chat')
    expect(mixed.host.textContent).not.toContain('Show More')
  })

  it('paginates past pinned backfill without skipping archived rows or over-fetching', async () => {
    const page0 = [
      rawRow('first-arch', 'First archived', 'default', { archived: true }),
      ...excluded(CHAT_LIST_PAGE - 1).map(row => ({ ...row, archived: true })),
      rawRow('arch-pin', 'Archived pinned', 'default', { archived: true, pinned: true }),
      rawRow('live-pin', 'Live pinned', 'default', { archived: false, pinned: true })
    ]
    const page1 = [
      rawRow('second-arch', 'Page two archived', 'default', { archived: true }),
      rawRow('live-pin', 'Live pinned', 'default', { archived: false, pinned: true })
    ]
    http
      .mockResolvedValueOnce({ sessions: page0, total: CHAT_LIST_PAGE + 1 })
      .mockResolvedValueOnce({ sessions: page1, total: CHAT_LIST_PAGE + 1 })
    const { host } = render()
    await settle()
    expect(http.mock.calls.map(call => call[1])).toEqual([chatListPath(0, 'only'), chatListPath(CHAT_LIST_PAGE, 'only')])
    expect(host.textContent).toContain('First archived')
    expect(host.textContent).toContain('Archived pinned')
    expect(host.textContent).toContain('Page two archived')
    expect(host.textContent).not.toContain('Live pinned')
  })

  it('treats a 404 voice/tags response as no tags while keeping transient failures fenced', async () => {
    http.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/plugins/conduit_push/voice/tags?profile=no-plugin') {
        throw Object.assign(new Error('Not Found'), { code: 404 })
      }
      if (path === '/api/plugins/conduit_push/voice/tags?profile=flaky') {
        throw Object.assign(new Error('Service Unavailable'), { code: 503 })
      }
      return {
        sessions: [
          rawRow('swept-1', 'Auto swept', 'no-plugin', { archived: true, auto_archived: true }),
          rawRow('call-1', 'Saved call', 'no-plugin', { archived: true, auto_archived: true, end_reason: 'conduit_voice' }),
          rawRow('swept-2', 'Flaky auto', 'flaky', { archived: true, auto_archived: true })
        ]
      }
    })
    const { host } = render({ visibleVoiceIds: new Set(['call-1']) })
    await settle()
    expect(host.textContent).not.toContain('Saved call')
    expect(button(host, 'Restore: Auto swept').disabled).toBe(false)
    expect(button(host, 'Delete: Auto swept').disabled).toBe(false)
    expect(button(host, 'Restore: Flaky auto').disabled).toBe(true)
    expect(button(host, 'Delete: Flaky auto').disabled).toBe(true)
    expect(host.textContent).toContain('Voice tags are unavailable.')
  })

  it('keeps already-classified profiles enabled across Show More batches', async () => {
    let tagReads = 0
    const page25 = Promise.withResolvers<unknown>()
    const tail = excluded(CHAT_LIST_PAGE)
    http.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/plugins/conduit_push/voice/tags?profile=work') {
        tagReads++
        return { tags: {} }
      }
      const offset = Number(new URL(path, 'https://first.example').searchParams.get('offset'))
      if (offset === 0) return { sessions: [rawRow('a1', 'Early auto', 'work', { auto_archived: true }), ...excluded(CHAT_LIST_PAGE - 1)] }
      if (offset < CHAT_LIST_MAX_PAGES * CHAT_LIST_PAGE) return { sessions: tail }
      return page25.promise
    })
    const { host } = render()
    await act(async () => { for (let i = 0; i < 100; i++) await Promise.resolve() })
    expect(tagReads).toBe(1)
    expect(button(host, 'Restore: Early auto').disabled).toBe(false)

    act(() => button(host, 'Show More').click())
    await act(async () => {
      page25.resolve({ sessions: [rawRow('a2', 'Later auto', 'work', { auto_archived: true })] })
    })
    await settle()
    expect(tagReads).toBe(1)
    expect(button(host, 'Restore: Early auto').disabled).toBe(false)
    expect(button(host, 'Restore: Later auto').disabled).toBe(false)
    expect(host.textContent).not.toContain('Voice tags are unavailable.')
  })
})
