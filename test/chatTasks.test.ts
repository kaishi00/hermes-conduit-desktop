import { describe, expect, it } from 'vitest'
import { afterRead, chatTasksLabel, chatTasksPath, parseChatTasks, shownTasks, type ChatTask } from '../src/renderer/src/state/chatTasks'

const task = (id: string, status: string, extra: Partial<ChatTask> = {}): ChatTask => ({ id, title: id, status, board: 'default', boardName: 'Default', ...extra })

describe('chat Kanban tasks (desktop#553)', () => {
  it('reads the plugin answer, dropping rows without an id or board', () => {
    const parsed = parseChatTasks({
      supported: true,
      tasks: [
        { id: 't1', title: 'Build it', status: 'Running', assignee: 'coder', board: 'research', board_name: 'Research', started_at: 5, error: null },
        { id: 't2', status: 'blocked', board: 'default', error: 'worker crashed' },
        { title: 'no id', board: 'default' },
        { id: 't3', title: 'no board' }
      ]
    })
    expect(parsed.supported).toBe(true)
    expect(parsed.tasks).toEqual([
      { id: 't1', title: 'Build it', status: 'running', assignee: 'coder', board: 'research', boardName: 'Research', error: undefined },
      { id: 't2', title: 't2', status: 'blocked', assignee: undefined, board: 'default', boardName: 'default', error: 'worker crashed' }
    ])
    expect(parseChatTasks({ tasks: [] }).supported).toBe(false)
    expect(parseChatTasks(null)).toEqual({ supported: false, tasks: [] })
  })

  it('asks for the chat by its session, on its profile', () => {
    expect(chatTasksPath('s 1')).toBe('/api/plugins/conduit_push/sessions/kanban-tasks?session_id=s%201')
    expect(chatTasksPath('s1', 'default')).toBe('/api/plugins/conduit_push/sessions/kanban-tasks?session_id=s1')
    expect(chatTasksPath('s1', 'coder')).toContain('session_id=s1&')
  })

  it('shows open tasks, and finished ones only once the chat saw its tasks open', () => {
    const done = task('a', 'done')
    const running = task('b', 'running')
    // Reopened after everything finished: nothing.
    expect(shownTasks([done], new Set())).toEqual([])
    // An open one shows; a finished one never seen open stays on the board.
    expect(shownTasks([done, running], new Set(['b']))).toEqual([running])
    // Seen open, now finished: the line stays to say so.
    const finished = task('b', 'done')
    expect(shownTasks([done, finished], new Set(['b']))).toEqual([finished])
  })

  it('remembers across reads which tasks the chat saw open', () => {
    const seen = new Set<string>()
    // Opened after the first card finished: only the running one shows.
    expect(afterRead([task('a', 'done'), task('b', 'running')], seen).map(t => t.id)).toEqual(['b'])
    // It finishes while the chat shows: the line stays, saying so.
    expect(afterRead([task('a', 'done'), task('b', 'done')], seen).map(t => t.id)).toEqual(['b'])
    // Another chat starts over (the hook gives it a new set): nothing.
    expect(afterRead([task('a', 'done'), task('b', 'done')], new Set())).toEqual([])
  })

  it('says how many are in progress and how many are blocked', () => {
    expect(chatTasksLabel([task('a', 'running'), task('b', 'todo')])).toBe('Kanban: 2 in progress')
    expect(chatTasksLabel([task('a', 'running'), task('b', 'blocked')])).toBe('Kanban: 1 in progress, 1 blocked')
    expect(chatTasksLabel([task('a', 'blocked'), task('b', 'done')])).toBe('Kanban: 1 blocked')
    expect(chatTasksLabel([task('a', 'done')])).toBe('Kanban tasks finished')
  })
})
