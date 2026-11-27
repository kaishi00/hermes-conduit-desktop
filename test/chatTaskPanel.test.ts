// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
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

async function draw(onOpen?: (task: unknown) => void) {
  // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
  const path = '../src/renderer/src/components/ChatTasksDock.tsx'
  const { ChatTasksDock } = (await import(/* @vite-ignore */ path)) as { ChatTasksDock: unknown }
  const box = document.createElement('div')
  document.body.append(box)
  const root = createRoot(box)
  const tasks = [{ id: 't2', title: 'Dig in', status: 'running', assignee: 'scout', board: 'research', boardName: 'Research' }]
  act(() => root.render(createElement(ChatTasksDock as never, { tasks, chatKey: 'c1', onOpen, bots: [] })))
  return { box, root }
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
})
