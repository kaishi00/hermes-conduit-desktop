// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWork, type WorkItem, type WorkSnapshot } from '../src/renderer/src/state/work'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const httpMock = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => httpMock(...args) },
  GatewayError: class extends Error {}
}))

const snapshot: WorkSnapshot = parseWork({
  policy: 'on',
  counts: { working: 1, needs_you: 0, ready: 0 },
  resolved_count: 1,
  workstream_sessions: ['s37', 's38'],
  work: [
    {
      ref: 'W37',
      kind: 'workstream',
      status: 'running',
      title: 'Inbox Zero deployment',
      session_id: 's37',
      branch: 'work/w37',
      actions: ['send', 'stop'],
      manage: ['pin', 'leave_alone'],
      updated_at: 200
    },
    {
      ref: 'A94',
      kind: 'ask_in',
      status: 'done',
      bot: 'Network',
      title: 'Camera VLAN audit answers',
      manage: ['pin', 'resolve'],
      updated_at: 150
    },
    {
      ref: 'A95',
      kind: 'ask_out',
      status: 'stopped',
      bot: 'Network',
      title: 'Unmanageable item',
      manage: [],
      updated_at: 100
    }
  ]
})

const resolvedPayload = {
  policy: 'on',
  work: [
    {
      ref: 'W38',
      kind: 'workstream',
      status: 'done',
      closed: true,
      title: 'Update UniFi Network MCP',
      session_id: 's38',
      manage: ['reopen'],
      updated_at: 90
    }
  ]
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  httpMock.mockReset()
  httpMock.mockResolvedValue({ ok: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function renderPanel(overrides: Record<string, unknown> = {}) {
  const path = '../src/renderer/src/components/WorkPanel.tsx'
  const { WorkPanel } = (await import(/* @vite-ignore */ path)) as { WorkPanel: unknown }
  const props = {
    profile: 'infra',
    botName: 'Infra',
    snapshot,
    error: null,
    onReload: vi.fn(),
    onOpenChat: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  act(() => {
    root.render(createElement(WorkPanel as never, props as never))
  })
  return props
}

function cardByRef(ref: string): HTMLElement {
  const badge = [...host.querySelectorAll('.work-ref')].find(el => el.textContent === ref)
  if (!badge) throw new Error(`Card ${ref} not found`)
  return badge.closest('.work-card') as HTMLElement
}

function rightClick(el: Element, coords = { clientX: 240, clientY: 180 }) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...coords })
  act(() => {
    el.dispatchEvent(event)
  })
  return event
}

const menuLabels = () => [...host.querySelectorAll('[role="menu"] button[role="menuitem"]')].map(b => b.textContent)
const menuButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')].find(b => b.textContent === label)!

describe('WorkPanel right-click context menu', () => {
  it('closes the menu when a refresh folds its card out of Recent', async () => {
    await renderPanel()
    rightClick(cardByRef('A94'))
    expect(menuLabels()).toContain('Resolve')
    const row = snapshot.items.find(i => i.ref === 'A94')!
    await renderPanel({ snapshot: { ...snapshot, items: [...['A1', 'A2', 'A3'].map(ref => ({ ...row, ref })), row] } })
    expect([...host.querySelectorAll('.work-ref')].map(el => el.textContent)).not.toContain('A94')
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('leaves report links to the native link menu', async () => {
    await renderPanel({ snapshot: { ...snapshot, items: snapshot.items.map(i => ({ ...i, result: '[Report](https://example.org/report)' })) } })
    const card = cardByRef('A94')
    act(() => card.querySelector<HTMLButtonElement>('.work-card-head')!.click())
    const link = card.querySelector<HTMLAnchorElement>('a[href]')!
    expect(rightClick(link).defaultPrevented).toBe(false)
    const key = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
    act(() => { link.dispatchEvent(key) })
    expect(key.defaultPrevented).toBe(false)
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('restores focus to the card after choosing a task action', async () => {
    await renderPanel()
    const head = cardByRef('A94').querySelector<HTMLButtonElement>('.work-card-head')!
    head.focus()
    rightClick(head)
    expect(document.activeElement).toBe(menuButton('Pin'))
    await act(async () => { menuButton('Pin').click() })
    expect(document.activeElement).toBe(head)
    await renderPanel({ snapshot: { ...snapshot, items: snapshot.items.map(i => i.ref === 'A94' ? { ...i, pinned: true } : i) } })
    expect(document.activeElement).toBe(cardByRef('A94').querySelector('.work-card-head'))
  })

  it.each(['menu', 'expanded'])('shows a clipboard failure on the card from the %s control', async source => {
    const write = vi.fn().mockImplementation(() => { throw new Error('Clipboard unavailable') })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    await renderPanel()
    const card = cardByRef('W37')
    if (source === 'menu') {
      rightClick(card)
      await act(async () => { menuButton('Copy Branch').click() })
    } else {
      act(() => card.querySelector<HTMLButtonElement>('.work-card-more')!.click())
      await act(async () => { card.querySelector<HTMLButtonElement>('.work-branch button')!.click() })
    }
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('Clipboard unavailable')
  })

  it('opens manage actions for an ask card and resolves it', async () => {
    const props = await renderPanel()
    const ev = rightClick(cardByRef('A94'))
    expect(ev.defaultPrevented).toBe(true)
    expect(menuLabels()).toEqual(['Pin', 'Resolve'])

    await act(async () => {
      menuButton('Resolve').click()
    })
    expect(httpMock).toHaveBeenCalledWith('POST', '/api/plugins/conduit_push/workstreams/A94/resolve?profile=infra', {})
    expect(props.onReload).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('offers manage, run actions, Open chat, and Copy Branch for a running workstream', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const props = await renderPanel()
    rightClick(cardByRef('W37'))
    expect(menuLabels()).toEqual(['Pin', 'Keep Infra out of this', 'Stop', 'Open W37’s chat', 'Copy Branch'])

    await act(async () => {
      menuButton('Stop').click()
    })
    expect(httpMock).toHaveBeenCalledWith('POST', '/api/plugins/conduit_push/workstreams/W37/stop?profile=infra', {})
    expect(props.onReload).toHaveBeenCalledTimes(1)

    rightClick(cardByRef('W37'))
    act(() => {
      menuButton('Open W37’s chat').click()
    })
    expect(props.onOpenChat).toHaveBeenCalledTimes(1)
    expect((props.onOpenChat.mock.calls[0][0] as WorkItem).ref).toBe('W37')

    rightClick(cardByRef('W37'))
    act(() => {
      menuButton('Copy Branch').click()
    })
    expect(writeText).toHaveBeenCalledWith('work/w37')
  })

  it('replaces an open menu when right-clicking another card and skips cards with no actions', async () => {
    await renderPanel()
    rightClick(cardByRef('W37'))
    expect(menuLabels()).toContain('Stop')

    rightClick(cardByRef('A94'))
    expect(host.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(menuLabels()).toEqual(['Pin', 'Resolve'])

    const noMenu = rightClick(cardByRef('A95'))
    expect(noMenu.defaultPrevented).toBe(false)
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('works in the Resolved list to Reopen a task', async () => {
    httpMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('resolved=1')) return resolvedPayload
      return { ok: true }
    })
    const props = await renderPanel()
    const resolvedBtn = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Resolved'))!
    await act(async () => {
      resolvedBtn.click()
    })

    rightClick(cardByRef('W38'))
    expect(menuLabels()).toEqual(['Reopen', 'Open W38’s chat'])

    await act(async () => {
      menuButton('Reopen').click()
    })
    expect(httpMock).toHaveBeenCalledWith('POST', '/api/plugins/conduit_push/workstreams/W38/reopen?profile=infra', {})
    expect(props.onReload).toHaveBeenCalledTimes(1)
  })

  it('shows refusal errors on the card when a menu action fails', async () => {
    httpMock.mockRejectedValueOnce(new Error('Already resolved'))
    await renderPanel()
    rightClick(cardByRef('A94'))
    await act(async () => {
      menuButton('Resolve').click()
    })
    expect(cardByRef('A94').querySelector('.error-text')?.textContent).toBe('Already resolved')
  })

  it('does not hijack right-click inside the reply input or on selected text in the card, but still opens when selection is elsewhere', async () => {
    await renderPanel()
    const detailsBtn = cardByRef('W37').querySelector<HTMLButtonElement>('.work-card-more')!
    act(() => detailsBtn.click())
    const input = cardByRef('W37').querySelector<HTMLInputElement>('.work-reply input')!
    const ev = rightClick(input)
    expect(ev.defaultPrevented).toBe(false)
    expect(host.querySelector('[role="menu"]')).toBeNull()

    const cardA94 = cardByRef('A94')
    const outside = document.createElement('p')
    outside.textContent = 'Chat transcript'
    document.body.append(outside)
    const origGetSelection = window.getSelection
    try {
      window.getSelection = (() => ({ toString: () => 'selected', anchorNode: cardA94.firstChild, focusNode: cardA94.firstChild })) as typeof window.getSelection
      const onCardSel = rightClick(cardA94)
      expect(onCardSel.defaultPrevented).toBe(false)
      expect(host.querySelector('[role="menu"]')).toBeNull()

      window.getSelection = (() => ({ toString: () => 'selected', anchorNode: outside.firstChild, focusNode: outside.firstChild })) as typeof window.getSelection
      const onOutsideSel = rightClick(cardA94)
      expect(onOutsideSel.defaultPrevented).toBe(true)
      expect(menuLabels()).toEqual(['Pin', 'Resolve'])
    } finally {
      window.getSelection = origGetSelection
      outside.remove()
    }
  })

  it('supports Shift+F10, arrow navigation, Escape focus return, and closes on scroll or click', async () => {
    await renderPanel()
    const headBtn = cardByRef('A94').querySelector<HTMLButtonElement>('.work-card-head')!
    headBtn.focus()
    act(() => {
      headBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(menuLabels()).toEqual(['Pin', 'Resolve'])
    expect(document.activeElement?.textContent).toBe('Pin')

    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement?.textContent).toBe('Resolve')

    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(headBtn)

    rightClick(cardByRef('A94'))
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    act(() => {
      host.querySelector('.work-body')!.dispatchEvent(new Event('scroll'))
    })
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('drops a refusal once a refresh changes its card, and keeps it while the card is the same', async () => {
    httpMock.mockRejectedValueOnce(new Error('Already resolved'))
    await renderPanel()
    rightClick(cardByRef('A94'))
    await act(async () => {
      menuButton('Resolve').click()
    })
    expect(cardByRef('A94').querySelector('[role="alert"]')?.textContent).toBe('Already resolved')
    await renderPanel({ snapshot: { ...snapshot, items: [...snapshot.items] } })
    expect(cardByRef('A94').querySelector('[role="alert"]')?.textContent).toBe('Already resolved')
    await renderPanel({ snapshot: { ...snapshot, items: snapshot.items.map(i => (i.ref === 'A94' ? { ...i, updatedAt: i.updatedAt + 1000 } : i)) } })
    expect(cardByRef('A94').querySelector('[role="alert"]')).toBeNull()
  })

  it('leaves Shift+F10 to the native menu while text in the card is selected', async () => {
    await renderPanel()
    const card = cardByRef('A94')
    const head = card.querySelector<HTMLButtonElement>('.work-card-head')!
    const origGetSelection = window.getSelection
    try {
      window.getSelection = (() => ({ toString: () => 'selected', anchorNode: card.firstChild, focusNode: card.firstChild })) as typeof window.getSelection
      const key = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
      act(() => {
        head.dispatchEvent(key)
      })
      expect(key.defaultPrevented).toBe(false)
      expect(host.querySelector('[role="menu"]')).toBeNull()
    } finally {
      window.getSelection = origGetSelection
    }
  })

  it('ArrowUp with nothing in the menu focused goes to its last entry', async () => {
    await renderPanel()
    rightClick(cardByRef('W37'))
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement?.textContent).toBe('Copy Branch')
  })
})
