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
    Object.assign(window, { conduit: { saveKanbanAttachment: async () => 'saved' } })
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
    act(() => root.unmount())
  })
})
