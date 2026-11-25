// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChatTasks } from '../src/renderer/src/state/useChatTasks'

type Props = { sid: string | null; running: boolean }
let paths: string[] = []
let boards: Record<string, { id: string; status: string }[]> = {}

beforeEach(() => {
  paths = []
  boards = {}
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (_method: string, path: string) => {
      paths.push(path)
      const sid = new URLSearchParams(path.split('?')[1] ?? '').get('session_id') ?? ''
      const tasks = (boards[sid] ?? []).map(t => ({ ...t, title: t.id, board: 'default' }))
      return { ok: true, result: { supported: true, tasks } }
    },
    onEvent: () => () => undefined
  }
})

const ids = (hook: { result: () => { tasks: { id: string }[] } }) => hook.result().tasks.map(t => t.id)

describe('a chat’s Kanban tasks hook (desktop#553)', () => {
  it('reads as the chat opens, again at a turn’s end, and starts over in another chat', async () => {
    boards.a = []
    const hook = renderHook(({ sid, running }: Props) => useChatTasks(sid, undefined, true, running), { sid: 'a', running: false })
    await settle()
    expect(paths).toEqual(['/api/plugins/conduit_push/sessions/kanban-tasks?session_id=a'])
    expect(ids(hook)).toEqual([])

    // The turn puts a card on the board; its end reads it.
    hook.rerender({ sid: 'a', running: true })
    boards.a = [{ id: 't1', status: 'running' }]
    hook.rerender({ sid: 'a', running: false })
    await settle()
    expect(ids(hook)).toEqual(['t1'])

    // Another chat whose card finished before it opened: nothing, and nothing of the last chat's.
    boards.b = [{ id: 't9', status: 'done' }]
    hook.rerender({ sid: 'b', running: false })
    await settle()
    expect(ids(hook)).toEqual([])
    hook.unmount()
  })

  it('shows nothing when this Hermes can’t tell', async () => {
    ;(window as unknown as { conduit: { httpOutcome: unknown } }).conduit.httpOutcome = async () => ({
      ok: true,
      result: { supported: false, tasks: [{ id: 't1', status: 'running', board: 'default' }] }
    })
    const hook = renderHook(({ sid, running }: Props) => useChatTasks(sid, undefined, true, running), { sid: 'a', running: false })
    await settle()
    expect(ids(hook)).toEqual([])
    hook.unmount()
  })
  it('keeps a finished task it saw open across a reconnect', async () => {
    boards.a = [{ id: 't1', status: 'running' }]
    type C = { connected: boolean }
    const hook = renderHook(({ connected }: C) => useChatTasks('a', undefined, connected, false), { connected: true })
    await settle()
    expect(ids(hook)).toEqual(['t1'])
    hook.rerender({ connected: false })
    boards.a = [{ id: 't1', status: 'done' }]
    hook.rerender({ connected: true })
    await settle()
    expect(hook.result().tasks.map(t => [t.id, t.status])).toEqual([['t1', 'done']])
    hook.unmount()
  })
})
