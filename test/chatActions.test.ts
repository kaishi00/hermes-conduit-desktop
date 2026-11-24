import { describe, expect, it } from 'vitest'
import { busyOnGateway, identityFields, moveChat, mutateSession, sessionIsBusy, sessionPath, warrantsRetry, withQuery } from '../src/renderer/src/state/chatActions'
import { httpErrorText } from '../src/main/connection'

describe('a chat row’s Pin, Rename and Delete', () => {
  it('go to the chat under its profile', () => {
    expect(sessionPath('a b', 'work', '/mutation-snapshot')).toBe('/api/sessions/a%20b/mutation-snapshot?profile=work')
    expect(sessionPath('s1', 'default')).toBe('/api/sessions/s1')
  })

  it('carry the revision the snapshot named', () => {
    expect(identityFields({ runtime_revision: 4, runtime_generation: 2 }, 'r')).toEqual({ request_id: 'r', expected_revision: 4, expected_generation: 2 })
    expect(identityFields({ runtime_revision: -1 }, 'r')).toBeNull()
    expect(identityFields(null, 'r')).toBeNull()
    expect(withQuery('/api/sessions/s1?profile=w', { request_id: 'r-1', expected_revision: 4 })).toBe('/api/sessions/s1?profile=w&expected_revision=4&request_id=r-1')
  })

  it('recognizes active session statuses by stored or live id', () => {
    const response = { sessions: [
      { id: 'live', session_key: 'stored', status: 'starting' },
      { id: 'running', status: 'working' },
      { id: 'approval', status: 'waiting' },
      { id: 'stream', status: 'streaming' },
      { id: 'resume', status: 'resuming' },
      { id: 'done', status: 'idle' }
    ] }
    expect(sessionIsBusy(response, 'stored')).toBe(true)
    expect(sessionIsBusy(response, 'running')).toBe(true)
    expect(sessionIsBusy(response, 'approval')).toBe(true)
    expect(sessionIsBusy(response, 'stream')).toBe(true)
    expect(sessionIsBusy(response, 'resume')).toBe(true)
    expect(sessionIsBusy(response, 'done')).toBe(false)
    expect(sessionIsBusy(response, 'another')).toBe(false)
  })

  it('try once more when the chat moved on in between', async () => {
    const calls: [string, string, unknown][] = []
    let refusals = 1
    const http = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push([method, path, body])
      if (method === 'GET') return { runtime_revision: calls.length } as T
      if (refusals-- > 0) throw Object.assign(new Error('revision_conflict: the session changed'), { code: 409 })
      return {} as T
    }
    await mutateSession(http, 's1', 'work', { pinned: true })
    expect(calls.map(c => c[0])).toEqual(['GET', 'PATCH', 'GET', 'PATCH'])
    expect(calls[3]![2]).toMatchObject({ pinned: true, profile: 'work', expected_revision: 3 })

    calls.length = 0
    await mutateSession(http, 's1', undefined, null)
    expect(calls[1]![0]).toBe('DELETE')
    expect(calls[1]![1]).toMatch(/^\/api\/sessions\/s1\?expected_revision=1&request_id=/)
  })
  it('archives and restores a chat under its own profile with a fresh revision', async () => {
    const calls: [string, string, unknown][] = []
    const http = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push([method, path, body])
      return (method === 'GET' ? { runtime_revision: 7, runtime_generation: 2 } : {}) as T
    }
    await mutateSession(http, 'chat/one', 'writer', { archived: true })
    await mutateSession(http, 'chat/one', 'writer', { archived: false })
    expect(calls.map(([method, path]) => [method, path])).toEqual([
      ['GET', '/api/sessions/chat%2Fone/mutation-snapshot?profile=writer'],
      ['PATCH', '/api/sessions/chat%2Fone?profile=writer'],
      ['GET', '/api/sessions/chat%2Fone/mutation-snapshot?profile=writer'],
      ['PATCH', '/api/sessions/chat%2Fone?profile=writer']
    ])
    expect(calls[1]![2]).toMatchObject({ archived: true, profile: 'writer', expected_revision: 7, expected_generation: 2 })
    expect(calls[3]![2]).toMatchObject({ archived: false, profile: 'writer', expected_revision: 7, expected_generation: 2 })
  })


  it('write without a revision on a host that has no snapshot', async () => {
    const calls: string[] = []
    const http = async <T,>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`)
      if (method === 'GET') throw Object.assign(new Error('Not Found'), { code: 404 })
      return {} as T
    }
    await mutateSession(http, 's1', undefined, { title: 'New' })
    expect(calls).toEqual(['GET /api/sessions/s1/mutation-snapshot', 'PATCH /api/sessions/s1'])
    expect(warrantsRetry(Object.assign(new Error('Not Found'), { code: 404 }))).toBe(false)
  })

  it('reads Hermes’ refusal whether its detail is words or a code', () => {
    expect(httpErrorText('session not found', 404)).toBe('session not found')
    expect(httpErrorText({ code: 'revision_conflict', message: 'moved on' }, 409)).toBe('revision_conflict: moved on')
    expect(httpErrorText(null, 500)).toBe('HTTP 500')
  })
})

describe('Move to Project', () => {
  it('moves the folder with session.workspace.move off the authority', async () => {
    const calls: unknown[] = []
    const rpc = async <T,>(method: string, params?: Record<string, unknown>) => (calls.push([method, params]), {} as T)
    const http = async <T,>() => ({}) as T
    await moveChat(rpc, http, 's1', 'coder', '/srv/site', false)
    expect(calls).toEqual([['session.workspace.move', { session_key: 's1', cwd: '/srv/site', profile: 'coder' }]])
  })

  it('sends a workspace mutation with the snapshot revision on the authority, and retries a conflict once', async () => {
    const sent: Record<string, unknown>[] = []
    let revision = 3
    const rpc = async <T,>(method: string, params?: Record<string, unknown>) => {
      sent.push({ method, ...params })
      if (sent.length === 1) {
        revision = 4
        throw new Error('revision_conflict')
      }
      return {} as T
    }
    const http = async <T,>() => ({ runtime_revision: revision, runtime_generation: 2 }) as T
    await moveChat(rpc, http, 's1', undefined, '/srv/site', true)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ method: 'session.mutate', session_id: 's1', operation: 'workspace', payload: { cwd: '/srv/site' }, expected_revision: 4, expected_generation: 2 })
  })
})

describe('the busy read before an Archive or a Delete (#438)', () => {
  const busy = { sessions: [{ id: 's1', status: 'working' }] }

  it('asks the row\'s own profile and reads the answer', async () => {
    const asked: unknown[] = []
    const rpc = async (method: string, params?: Record<string, unknown>) => {
      asked.push([method, params])
      return busy
    }
    expect(await busyOnGateway(rpc, 's1', 'furina')).toBe(true)
    expect(await busyOnGateway(rpc, 's2', 'default')).toBe(false)
    expect(asked).toEqual([
      ['session.active_list', { profile: 'furina' }],
      ['session.active_list', undefined]
    ])
  })

  it('lets the change through on a Hermes that has no such read', async () => {
    // As the gateway refuses it, with the JSON-RPC code or only its words.
    const coded = Object.assign(new Error('unknown method: session.active_list'), { code: -32601 })
    expect(await busyOnGateway(async () => Promise.reject(coded), 's1')).toBe(false)
    expect(await busyOnGateway(async () => Promise.reject(new Error('Method not found')), 's1')).toBe(false)
  })

  it('still stops the change when the gateway could not be asked', async () => {
    await expect(busyOnGateway(async () => Promise.reject(new Error('Not connected.')), 's1')).rejects.toThrow('Not connected.')
  })
})
