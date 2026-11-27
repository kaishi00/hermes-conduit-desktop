// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { settle } from './hookHarness'

const task = { id: 't1', title: 'Write the report', status: 'done', priority: 0, commentCount: 0 }
const detail = {
  task,
  comments: [],
  events: [],
  runs: [],
  attachments: [{ id: 'a1', filename: 'report.md', size: 12 }],
  parents: [],
  children: []
}

describe("a Kanban task's attachments", () => {
  it("can't be saved once the task is no longer on the board shown", async () => {
    const saves: string[] = []
    Object.assign(window, { conduit: { saveKanbanAttachment: async (id: string) => (saves.push(id), 'saved') } })
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/KanbanBoard.tsx'
    const { TaskPanel } = (await import(/* @vite-ignore */ path)) as { TaskPanel: (p: Record<string, unknown>) => null }
    const host = document.createElement('div')
    const root = createRoot(host)
    const props = (shownTask: typeof task | null) => ({
      id: 't1',
      task: shownTask,
      assignees: [],
      botTitle: (name?: string) => name ?? '',
      load: async () => detail,
      board: null,
      touched: { revision: 0, ids: new Set<string>() },
      onClose: () => {},
      onPatch: async () => {},
      onComment: async () => {},
      onDelete: async () => {}
    })
    const save = () => [...host.querySelectorAll('.task-attachment button')][0] as HTMLButtonElement

    act(() => root.render(createElement(TaskPanel, props(task))))
    await settle()
    expect(save().disabled).toBe(false)
    expect(save().title).toBe('')

    // Hermes' current board changed elsewhere: the board read no longer has the task.
    act(() => root.render(createElement(TaskPanel, props(null))))
    await settle()
    expect(save().disabled).toBe(true)
    expect(save().title).toBe('This task is no longer on the board shown.')
    act(() => save().click())
    await settle()
    expect(saves).toEqual([])
    act(() => root.unmount())
  })

  it('keeps the task on screen and says so when a read again fails, until one succeeds', async () => {
    Object.assign(window, { conduit: {} })
    const path = '../src/renderer/src/components/KanbanBoard.tsx'
    const { TaskPanel } = (await import(/* @vite-ignore */ path)) as { TaskPanel: (p: Record<string, unknown>) => null }
    const host = document.createElement('div')
    const root = createRoot(host)
    let fail = false
    const props = (revision: number) => ({
      id: 't1',
      task: null,
      assignees: [],
      botTitle: (name?: string) => name ?? '',
      load: async () => {
        if (fail) throw new Error('offline')
        return detail
      },
      board: null,
      pinned: true,
      touched: { revision, ids: new Set(['t1']) },
      onClose: () => {},
      onPatch: async () => {},
      onComment: async () => {},
      onDelete: async () => {}
    })
    act(() => root.render(createElement(TaskPanel, props(0))))
    await settle()
    expect(host.textContent).toContain('Write the report')
    expect(host.querySelector('.error-text')).toBeNull()

    fail = true
    act(() => root.render(createElement(TaskPanel, props(1))))
    await settle()
    expect(host.textContent).toContain('Write the report')
    expect(host.querySelector('.error-text')?.textContent).toBe('Couldn’t load this task: offline')

    fail = false
    act(() => root.render(createElement(TaskPanel, props(2))))
    await settle()
    expect(host.textContent).toContain('Write the report')
    expect(host.querySelector('.error-text')).toBeNull()
    act(() => root.unmount())
  })
})
