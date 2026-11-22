import { describe, expect, it } from 'vitest'
import { ageText, boardPath, boardPollDelay, failedInTransit, columnTitle, defaultAssignee, matchesTask, parseBoard, parseBoards, parseTaskDetail, priorityTitle } from '../src/renderer/src/state/kanban'

describe('the task board', () => {
  it('reads the lanes in the phone’s order, a lane it doesn’t know last', () => {
    const board = parseBoard({
      columns: [
        { name: 'done', tasks: [{ id: 't1', title: 'Shipped', status: 'done', priority: 0, completed_at: 1795000000 }] },
        { name: 'custom_step', tasks: [] },
        { name: 'triage', tasks: [{ id: 't2', title: 'Look into it', status: 'triage', priority: 2, comment_count: 3, progress: { done: 1, total: 4 }, warnings: { count: 2 } }, { title: 'no id' }] },
        { tasks: [] }
      ],
      assignees: ['default', 'work', 7]
    })
    expect(board.columns.map(c => c.name)).toEqual(['triage', 'done', 'custom_step'])
    expect(board.columns[0]!.tasks).toEqual([
      expect.objectContaining({ id: 't2', priority: 2, commentCount: 3, progress: { done: 1, total: 4 }, warnings: 2 })
    ])
    expect(board.columns[1]!.tasks[0]!.completedAt).toBe(1795000000000)
    expect(board.assignees).toEqual(['default', 'work'])
    expect(columnTitle('custom_step')).toBe('Custom step')
  })

  it('reads the boards with the server’s current one marked', () => {
    expect(parseBoards({ boards: [{ slug: 'default', name: 'Default', total: 3 }, { slug: 'ops', is_current: false }], current: 'default' })).toEqual([
      { slug: 'default', name: 'Default', total: 3, current: true },
      { slug: 'ops', name: 'ops', total: 0, current: false }
    ])
  })

  it('reads a task with its comments and linked tasks by title', () => {
    const detail = parseTaskDetail({
      task: { id: 't3', title: 'Child', status: 'blocked', priority: 0 },
      comments: [{ id: 1, author: 'dashboard', body: 'Use the word river.', created_at: 1795000000 }],
      events: [{ id: 9, kind: 'status' }],
      links: { parents: ['t1'], children: ['t4'] },
      link_tasks: [{ id: 't1', title: 'Parent', status: 'done' }],
      child_results: [{ id: 't4', latest_summary: 'Half done' }]
    })
    expect(detail?.comments[0]).toEqual({ id: '1', author: 'dashboard', body: 'Use the word river.', createdAt: 1795000000000 })
    expect(detail?.parents).toEqual([{ id: 't1', title: 'Parent', status: 'done' }])
    expect(detail?.children).toEqual([{ id: 't4', title: 't4', status: '', summary: 'Half done' }])
    expect(parseTaskDetail({})).toBeNull()
  })

  it("takes a child's result over its latest run summary, as the phone does", () => {
    const detail = parseTaskDetail({
      task: { id: 'p', title: 'Parent', status: 'todo', priority: 0 },
      links: { children: ['c'] },
      child_results: [{ id: 'c', latest_summary: 'Run summary', result: 'Handed back' }]
    })
    expect(detail?.children[0]?.summary).toBe('Handed back')
  })

  it('names the board only when one is picked', () => {
    expect(boardPath('/board', null)).toBe('/api/plugins/kanban/board')
    expect(boardPath('/tasks/t1', 'my board')).toBe('/api/plugins/kanban/tasks/t1?board=my%20board')
    expect(boardPath('/tasks/t1/log', 'ops', { tail: '100' })).toBe('/api/plugins/kanban/tasks/t1/log?board=ops&tail=100')
  })

  it('finds cards by every word typed, and says priorities and ages as the phone does', () => {
    const task = { id: 't9', title: 'Write the release notes', assignee: 'atlas', status: 'ready', priority: 0, commentCount: 0 }
    expect(matchesTask(task, 'release atlas')).toBe(true)
    expect(matchesTask(task, 'release ops')).toBe(false)
    expect([0, 1, 2, 3, 5].map(priorityTitle)).toEqual(['Normal', 'High', 'Urgent', 'Critical', 'Critical'])
    const now = Date.parse('2026-11-18T12:00:00Z')
    expect(ageText(now - 30_000, now)).toBe('1 min')
    expect(ageText(now - 3 * 3_600_000, now)).toBe('3 h')
    expect(ageText(now - 2 * 86_400_000, now)).toBe('2 d')
    expect(defaultAssignee({ resolved_default_assignee: ' atlas ' })).toBe('atlas')
    expect(defaultAssignee(null)).toBe('default')
  })
})

describe('how often the board is read', () => {
  it('spaces the poll out while reads find nothing new, as the phone does', () => {
    expect([0, 14, 15, 44, 45, 200].map(boardPollDelay)).toEqual([8000, 8000, 15_000, 15_000, 30_000, 30_000])
  })

  it('asks again only for a read lost in transit, never for Hermes’ own refusal', () => {
    expect(failedInTransit(new Error('fetch failed'))).toBe(true)
    expect([408, 429, 500, 502, 503].map(code => failedInTransit({ code }))).toEqual([true, true, true, true, true])
    expect([400, 401, 403, 404, 409].map(code => failedInTransit({ code }))).toEqual([false, false, false, false, false])
  })
})
