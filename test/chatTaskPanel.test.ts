// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { settle } from './hookHarness'

// A chat's Kanban task opens in a panel over the chat (desktop#593): read on its own board, with Open in Tasks beside Close.
type Outcome = { ok: true; result: unknown }
let calls: { method: string; path: string }[] = []

beforeEach(() => {
  localStorage.clear()
  calls = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (method: string, path: string): Promise<Outcome> => {
      calls.push({ method, path })
      if (path.startsWith('/api/plugins/kanban/tasks/t2')) {
        return { ok: true, result: { task: { id: 't2', title: 'Dig in', status: 'running', body: 'Find the cause' }, comments: [], events: [], links: { parents: [], children: [] } } }
      }
      return { ok: true, result: {} }
    },
    onEvent: () => () => undefined
  }
})

async function draw(onOpen?: (task: unknown) => void, status = 'running') {
  // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
  const path = '../src/renderer/src/components/ChatTasksDock.tsx'
  const { ChatTasksDock } = (await import(/* @vite-ignore */ path)) as { ChatTasksDock: unknown }
  const box = document.createElement('div')
  document.body.append(box)
  const root = createRoot(box)
  const render = (now: string) => {
    const tasks = [{ id: 't2', title: 'Dig in', status: now, assignee: 'scout', board: 'research', boardName: 'Research' }]
    act(() => root.render(createElement(ChatTasksDock as never, { tasks, chatKey: 'c1', onOpen, bots: [] })))
  }
  render(status)
  return { box, root, render }
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click())

describe('A chat’s Kanban task in the chat', () => {
  it('opens the task over the chat from its row, on its own board, and Open in Tasks goes on to the board', async () => {
    const opened: unknown[] = []
    const { box, root } = await draw(task => opened.push(task))
    click(box.querySelector('.plan-toggle'))
    // The row is the button: no Open in Tasks link per row any more.
    expect(box.querySelector('.chat-task .link')).toBeNull()
    click(box.querySelector('.chat-task-open'))
    await settle()
    const panel = box.querySelector('.task-panel')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Find the cause')
    expect(calls.some(call => call.method === 'GET' && call.path.startsWith('/api/plugins/kanban/tasks/t2') && call.path.includes('board=research'))).toBe(true)
    // Tasks' board pick is left alone.
    expect(localStorage.getItem('conduit.kanbanBoard')).toBeNull()

    const go = [...(panel?.querySelectorAll('.task-panel-head button.link') ?? [])].find(button => button.textContent === 'Open in Tasks')
    click(go)
    expect(opened).toHaveLength(1)
    expect(box.querySelector('.task-panel')).toBeNull()
    act(() => root.unmount())
  })

  it('has no Open in Tasks in a window without Tasks, and Close shuts the panel', async () => {
    const { box, root } = await draw()
    click(box.querySelector('.plan-toggle'))
    click(box.querySelector('.chat-task-open'))
    await settle()
    expect(box.querySelector('.task-panel-head button.link')).toBeNull()
    click(box.querySelector('.task-panel-head [aria-label="Close"]'))
    expect(box.querySelector('.task-panel')).toBeNull()
    act(() => root.unmount())
  })

  it('reads the open task again when the line sees it move on, not on an unchanged read', async () => {
    const { box, root, render } = await draw()
    click(box.querySelector('.plan-toggle'))
    click(box.querySelector('.chat-task-open'))
    await settle()
    const reads = () => calls.filter(call => call.method === 'GET' && call.path.startsWith('/api/plugins/kanban/tasks/t2')).length
    const first = reads()
    render('running')
    await settle()
    expect(reads()).toBe(first)
    render('review')
    await settle()
    expect(reads()).toBe(first + 1)
    act(() => root.unmount())
  })

  it('lets an attachment be saved from the panel: the board is the task’s own', async () => {
    const saved: unknown[] = []
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    const answer = conduit.httpOutcome as (method: string, path: string) => Promise<Outcome>
    conduit.httpOutcome = async (method: string, path: string) => {
      if (path.startsWith('/api/plugins/kanban/tasks/t2')) {
        calls.push({ method, path })
        return { ok: true, result: { task: { id: 't2', title: 'Dig in', status: 'done' }, comments: [], events: [], attachments: [{ id: 'a1', filename: 'report.md', size: 10 }], links: { parents: [], children: [] } } }
      }
      return answer(method, path)
    }
    conduit.saveKanbanAttachment = async (...args: unknown[]) => {
      saved.push(args)
      return 'saved'
    }
    const { box, root } = await draw()
    click(box.querySelector('.plan-toggle'))
    click(box.querySelector('.chat-task-open'))
    await settle()
    const save = [...box.querySelectorAll('.task-panel button.secondary')].find(button => button.textContent === 'Save') as HTMLButtonElement | undefined
    expect(save?.disabled).toBe(false)
    click(save)
    await settle()
    expect(saved).toEqual([['a1', 'research', 'report.md']])
    act(() => root.unmount())
  })

  it('reads the open task again every 15 s while the window shows, so a new summary shows', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { box, root } = await draw()
    click(box.querySelector('.plan-toggle'))
    click(box.querySelector('.chat-task-open'))
    await settle()
    const reads = () => calls.filter(call => call.method === 'GET' && call.path.startsWith('/api/plugins/kanban/tasks/t2')).length
    const first = reads()
    act(() => vi.advanceTimersByTime(15_000))
    await settle()
    expect(reads()).toBe(first + 1)
    act(() => root.unmount())
    act(() => vi.advanceTimersByTime(30_000))
    expect(reads()).toBe(first + 1)
  })

  it('closes when the task is gone from its board, and the line reads again', async () => {
    const conduit = (window as unknown as { conduit: Record<string, unknown> }).conduit
    const answer = conduit.httpOutcome as (method: string, path: string) => Promise<unknown>
    let deleted = false
    conduit.httpOutcome = async (method: string, path: string) => {
      if (deleted && path.startsWith('/api/plugins/kanban/tasks/t2')) return { ok: false, error: 'task not found', code: 404 }
      return answer(method, path)
    }
    const path = '../src/renderer/src/components/ChatTasksDock.tsx'
    const { ChatTasksDock } = (await import(/* @vite-ignore */ path)) as { ChatTasksDock: unknown }
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    let changed = 0
    const draw2 = (status: string) =>
      act(() =>
        root.render(
          createElement(ChatTasksDock as never, {
            tasks: [{ id: 't2', title: 'Dig in', status, board: 'research', boardName: 'Research' }],
            chatKey: 'c1',
            bots: [],
            onChanged: () => changed++
          })
        )
      )
    draw2('running')
    click(box.querySelector('.plan-toggle'))
    click(box.querySelector('.chat-task-open'))
    await settle()
    expect(box.querySelector('.task-panel')).not.toBeNull()
    deleted = true
    draw2('done')
    await settle()
    expect(box.querySelector('.task-panel')).toBeNull()
    expect(changed).toBe(1)
    act(() => root.unmount())
  })
})

afterEach(() => vi.useRealTimers())
