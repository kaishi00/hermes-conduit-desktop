// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { settle } from './hookHarness'

// Open in Tasks from a chat's Kanban line (desktop#553): Board, the task's board, the task, once.
type Outcome = { ok: true; result: unknown }
let boardsRead: string[] = []

function answer(path: string): Outcome {
  if (path.startsWith('/api/plugins/kanban/boards')) {
    return { ok: true, result: { boards: [{ slug: 'default', name: 'Default', is_current: true }, { slug: 'research', name: 'Research' }] } }
  }
  if (path.startsWith('/api/plugins/kanban/board')) {
    const slug = new URLSearchParams(path.split('?')[1] ?? '').get('board') ?? 'default'
    boardsRead.push(slug)
    const tasks = slug === 'research' ? [{ id: 't2', title: 'Dig in' }] : [{ id: 't1', title: 'Other' }]
    return { ok: true, result: { columns: [{ name: 'running', tasks }] } }
  }
  return { ok: true, result: {} }
}

beforeEach(() => {
  localStorage.clear()
  boardsRead = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (_method: string, path: string) => answer(path),
    keptHttp: async (_url: string, path: string) => answer(path),
    onEvent: () => () => undefined
  }
})

describe('Open in Tasks from a chat’s Kanban line', () => {
  it('goes to Board even when Tasks last showed Scheduled, opens the task on its board once', async () => {
    localStorage.setItem('conduit.tasksSegment', 'scheduled')
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/Tasks.tsx'
    const { Tasks } = (await import(/* @vite-ignore */ path)) as { Tasks: unknown }
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    let spent = 0
    let focus: { slug: string; id: string; n: number } | null = { slug: 'research', id: 't2', n: 1 }
    const draw = () =>
      act(() =>
        root.render(
          createElement(Tasks as never, {
            bots: [],
            connected: true,
            profile: null,
            onProfile: () => {},
            onOpenRun: () => {},
            focus,
            onFocused: () => {
              spent += 1
              focus = null
            }
          } as never)
        )
      )
    draw()
    for (let i = 0; i < 4; i++) await settle()
    expect(localStorage.getItem('conduit.tasksSegment')).toBe('board')
    expect(boardsRead).toContain('research')
    expect(box.querySelector('aside.task-panel')?.textContent).toContain('Dig in')
    expect(spent).toBe(1)

    // Back to Tasks later: nothing opens again.
    act(() => root.unmount())
    const again = createRoot(box)
    act(() => again.render(createElement(Tasks as never, { bots: [], connected: true, profile: null, onProfile: () => {}, onOpenRun: () => {}, focus } as never)))
    for (let i = 0; i < 3; i++) await settle()
    expect(box.querySelector('aside.task-panel')).toBeNull()
    expect(spent).toBe(1)
    act(() => again.unmount())
    box.remove()
  })
})
