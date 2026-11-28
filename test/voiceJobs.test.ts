import { describe, expect, it } from 'vitest'
import { GatewayError } from '../src/renderer/src/gateway'
import {
  jobPrompt,
  MAX_SAVED_JOBS,
  SAVED_JOB_MAX_AGE_MS,
  VoiceJobs,
  completionPrompt,
  correctionMayHaveGone,
  jobTitle,
  listResult,
  mergeLedger,
  replyAfter,
  restoredFor,
  type LedgerStore,
  type SavedJob,
  type VoiceJob
} from '../src/renderer/src/state/voiceJobs'

type Event = { type: string; session_id?: string; payload?: unknown }

function setup(fail = false, correction: 'redirected' | 'queued' | 'rejected' = 'redirected', correctionError?: Error) {
  const corrected: [string, string, string | undefined][] = []
  const adopted: [string | undefined, string, string, string][] = []
  const calls: [string, Record<string, unknown>][] = []
  const surfaced: unknown[][] = []
  let handler: (event: Event) => void = () => {}
  const changes: VoiceJob[][] = []
  const told: string[] = []
  let n = 0
  const jobs = new VoiceJobs(
    'work',
    list => changes.push(list),
    notice => told.push(notice),
    async (method, params) => {
      calls.push([method, params])
      if (fail && method === 'prompt.submit') throw new Error('HTTP 500')
      return method === 'session.create' ? { session_id: `s${++n}`, stored_session_id: `stored${n}` } : {}
    },
    h => {
      handler = h
      return () => (handler = () => {})
    },
    async (sid, text, profile) => {
      corrected.push([sid, text, profile])
      if (correctionError) throw correctionError
      return correction
    },
    async (profile, sid, title, goal) => {
      adopted.push([profile, sid, title, goal])
      return true
    },
    async () => undefined,
    {
      report: async (sid, text, input, heard) => {
        surfaced.push(['report', sid, text, input, heard])
      },
      discard: (sid, text) => {
        surfaced.push(['discard', sid, text])
      }
    }
  )
  return { jobs, calls, changes, told, corrected, adopted, surfaced, emit: (e: Event) => handler(e) }
}

describe('background jobs from a call', () => {
  it('starts a job in a chat of its own and tells its reply', async () => {
    const { jobs, calls, told, adopted, surfaced, emit } = setup()
    const started = await jobs.start('Research the best GPU for training')
    // Its turn says it was spoken here, as the phone's job does.
    expect(surfaced).toEqual([['report', 's1', jobPrompt('Research the best GPU for training'), 'spoken', false]])
    expect(started).toMatchObject({ status: 'started', job_id: 'job-1' })
    expect(calls).toEqual([
      ['session.create', { cols: 96, source: 'desktop', title: 'Research the best GPU for training', profile: 'work' }],
      ['prompt.submit', { session_id: 's1', text: jobPrompt('Research the best GPU for training'), profile: 'work' }]
    ])
    expect(adopted).toEqual([['work', 'stored1', 'Research the best GPU for training', 'Research the best GPU for training']])
    emit({ type: 'message.delta', session_id: 'other', payload: { text: 'nope' } })
    emit({ type: 'message.delta', session_id: 's1', payload: { text: 'The 5090, ' } })
    emit({ type: 'message.delta', session_id: 's1', payload: { text: 'see MEDIA:/tmp/x/gpus.csv' } })
    emit({ type: 'message.complete', session_id: 's1', payload: {} })
    expect(jobs.jobs[0]).toMatchObject({ status: 'done', reply: 'The 5090, see MEDIA:/tmp/x/gpus.csv' })
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('Background job "Research the best GPU for training" finished')
    expect(told[0]).toContain('(a file in the chat: gpus.csv)')
  })

  it('holds three at once, lists and cancels them', async () => {
    const { jobs, calls } = setup()
    for (const task of ['a', 'b', 'c']) await jobs.start(task)
    expect((await jobs.start('d')).error).toMatch(/3 background jobs/)
    expect(jobs.list()).toMatchObject({ summary: 'a is still running. b is still running. c is still running.', job_2: 'id=job-2; title=b; status=running' })
    expect((await jobs.cancel('job-2')).message).toBe('Cancelled b.')
    expect(calls.at(-1)).toEqual(['session.interrupt', { session_id: 's2', profile: 'work' }])
    expect((await jobs.cancel()).message).toBe('Cancelled 2 background jobs.')
    expect((await jobs.cancel()).message).toBe('There are no background jobs to cancel.')
  })

  it('says a failure, at start or at the end of the turn', async () => {
    const { jobs, surfaced } = setup(true)
    expect((await jobs.start('x')).error).toMatch(/couldn't start: HTTP 500/)
    // A send that failed drops its report.
    expect(surfaced.map(entry => entry[0])).toEqual(['report', 'discard'])
    expect(jobs.jobs[0]!.status).toBe('failed')
    const second = setup()
    await second.jobs.start('y')
    second.emit({ type: 'error', session_id: 's1', payload: { message: 'Provider refused' } })
    expect(second.jobs.jobs[0]!.status).toBe('running')
    second.emit({ type: 'message.complete', session_id: 's1', payload: { status: 'error' } })
    expect(second.told[0]).toBe('[Background job "y" failed: Provider refused. Tell the user in a sentence.]')
  })

  it('keeps titles to one short line and clips long results', () => {
    expect(jobTitle('one\ntwo   three')).toBe('one two three')
    expect(jobTitle('x'.repeat(80))).toHaveLength(60)
    expect(completionPrompt('t', 'y'.repeat(7000))).toMatch(/\n\[…\]$/)
    expect(listResult([])).toEqual({ summary: 'No background jobs are running.' })
  })
})

describe("GPT-Live's background words", () => {
  it('runs a delegation as a job only when the user asks for one', async () => {
    const { asksForBackground } = await import('../src/renderer/src/state/voiceJobs')
    expect(asksForBackground('Research GPUs in the background')).toBe(true)
    expect(asksForBackground('Do it in a  separate chat please')).toBe(true)
    expect(asksForBackground('在后台运行这个')).toBe(true)
    expect(asksForBackground('What is in the background of this photo?')).toBe(true)
    expect(asksForBackground('Check the repo')).toBe(false)
  })
})

describe('correcting a running job', () => {
  it("puts the user's words into the job, and says when it's too late", async () => {
    const { jobs, corrected, emit } = setup()
    await jobs.start('Book a table for two')
    expect((await jobs.followUp('job-9', 'make it three')).error).toMatch(/Unknown job_id/)
    expect((await jobs.followUp('job-1', '  ')).error).toBe('message is required')
    const sent = await jobs.followUp('job-1', 'make it three')
    expect(sent).toMatchObject({ status: 'sent' })
    expect(sent.message).toMatch(/at once/)
    expect(corrected).toEqual([['s1', '(voice) make it three', 'work']])
    emit({ type: 'message.complete', session_id: 's1', payload: { text: 'Booked.' } })
    expect((await jobs.followUp('job-1', 'and a high chair')).status).toBe('not_sent')
    const queued = setup(false, 'queued')
    await queued.jobs.start('x')
    expect((await queued.jobs.followUp('job-1', 'y')).message).toMatch(/right after the step/)
  })
})

describe('a request with no answer back', () => {
  // hermes-conduit 3361 / desktop issue 732: one main marks as never sent stays not sent, whatever its words,
  // and a job's own submit with no answer back tells the call Hermes may have it.
  it('reads main\'s not_connected reason, and a job submit that may have gone says so', async () => {
    const { GatewayError } = await import('../src/renderer/src/gateway')
    const { correctionMayHaveGone } = await import('../src/renderer/src/state/voiceJobs')
    expect(correctionMayHaveGone(new GatewayError('socket closed', undefined, 'not_connected'))).toBe(false)
    expect(correctionMayHaveGone(new GatewayError('Request timed out'))).toBe(true)

    const failingSubmit = (error: Error) => {
      const { jobs } = setup()
      const rpc = (jobs as unknown as { rpc: (m: string, p: Record<string, unknown>) => Promise<unknown> }).rpc
      ;(jobs as unknown as { rpc: typeof rpc }).rpc = async (method, params) => {
        if (method === 'prompt.submit') throw error
        return rpc(method, params)
      }
      return jobs
    }
    expect(await failingSubmit(new GatewayError('Request timed out')).start('Book a table')).toMatchObject({ status: 'error', delivery: 'unknown' })
    expect(await failingSubmit(new GatewayError('socket closed', undefined, 'not_connected')).start('Book a table')).not.toHaveProperty('delivery')
    expect(await failingSubmit(new GatewayError('busy', -32000)).start('Book a table')).not.toHaveProperty('delivery')
  })
})

describe("GPT-Live's job follow-ups", () => {
  it('reads "Job 2:" and "Add to job 2:" at the start only', async () => {
    const { jobFollowUpMarker } = await import('../src/renderer/src/state/voiceJobs')
    expect(jobFollowUpMarker('Job 2: make it Alex')).toEqual({ jobId: 'job-2', words: 'make it Alex' })
    expect(jobFollowUpMarker('add to job #1: also a quiet table')).toEqual({ jobId: 'job-1', words: 'also a quiet table' })
    expect(jobFollowUpMarker('Check job 2: status')).toBeNull()
  })
})

describe('jobs kept past their call', () => {
  const memory = (initial: SavedJob[] = []) => {
    let saved = initial
    return { store: { read: () => saved, write: (jobs: SavedJob[]) => (saved = jobs) } as LedgerStore, get: () => saved }
  }

  it('keeps a running job for the next call in the chat, which reads its reply from the chat', async () => {
    const ledger = memory()
    const first = setup()
    first.jobs.keepWith('chat-a', ledger.store)
    await first.jobs.start('Check the deploy')
    first.jobs.dispose()
    expect(ledger.get()).toMatchObject([{ profile: 'work', chat: 'chat-a', stored: 'stored1', status: 'running' }])

    // Another chat's call doesn't get it.
    const other = setup()
    other.jobs.keepWith('chat-b', ledger.store, async () => ({ messages: [] }))
    expect(other.jobs.jobs).toEqual([])

    const sentAt = ledger.get()[0]!.sentAt
    let page: unknown = { messages: [{ role: 'user', text: 'Check the deploy', timestamp: sentAt / 1000 }] }
    const paths: string[] = []
    const next = setup()
    next.jobs.keepWith('chat-a', ledger.store, async (_m, path) => (paths.push(path), page))
    expect(next.jobs.jobs).toMatchObject([{ id: 'job-1', title: 'Check the deploy', status: 'running', restored: true }])
    await new Promise(r => setTimeout(r, 0))
    expect(next.told).toEqual([])
    expect(paths[0]).toContain('/api/sessions/stored1/messages?order=latest&limit=20&inline_images=false&profile=work')
    page = {
      messages: [
        { role: 'user', text: 'Check the deploy', timestamp: sentAt / 1000 },
        { role: 'assistant', text: 'All green.', timestamp: sentAt / 1000 + 30 }
      ]
    }
    await (next.jobs as unknown as { readRestored(): Promise<void> }).readRestored()
    expect(next.jobs.jobs[0]).toMatchObject({ status: 'done', reply: 'All green.', told: true })
    expect(next.told).toEqual([completionPrompt('Check the deploy', 'All green.')])
    next.jobs.dispose()
    // Told: the ledger lets it go.
    expect(ledger.get()).toEqual([])
  })

  it('tells a job that settled after its call at the next call in that chat, once', async () => {
    const ledger = memory()
    const first = setup()
    first.jobs.keepWith('chat-a', ledger.store)
    await first.jobs.start('Summarize the logs')
    first.jobs.dispose()
    // Settled while no call listened.
    first.emit({ type: 'message.complete', session_id: 's1', payload: { text: 'Quiet night.' } })
    expect(first.told).toEqual([])
    const next = setup()
    next.jobs.keepWith('chat-a', ledger.store, async () => ({ messages: [{ role: 'assistant', text: 'Quiet night.', timestamp: Date.now() / 1000 }] }))
    await (next.jobs as unknown as { readRestored(): Promise<void> }).readRestored()
    expect(next.told).toEqual([completionPrompt('Summarize the logs', 'Quiet night.')])
    next.jobs.dispose()
    const later = setup()
    later.jobs.keepWith('chat-a', ledger.store, async () => ({ messages: [] }))
    expect(later.jobs.jobs).toEqual([])
  })

  it('keeps a day of jobs, twelve settled at most, running ones always', () => {
    const now = 10 * SAVED_JOB_MAX_AGE_MS
    const job = (i: number, status: SavedJob['status'], sentAt = now - i): SavedJob => ({
      profile: '',
      chat: 'c',
      title: `t${i}`,
      stored: `s${i}`,
      sentAt,
      status
    })
    const settled = Array.from({ length: 15 }, (_, i) => job(i, 'done'))
    const merged = mergeLedger([job(99, 'running', now - SAVED_JOB_MAX_AGE_MS - 1), ...settled], [job(100, 'running')], ['s0'], now)
    expect(merged.filter(j => j.status === 'running').map(j => j.stored)).toEqual(['s100'])
    expect(merged.filter(j => j.status === 'done')).toHaveLength(MAX_SAVED_JOBS - 1)
    expect(merged.some(j => j.stored === 's0')).toBe(false)
    expect(restoredFor(merged, undefined, 'c', now)).toHaveLength(MAX_SAVED_JOBS)
  })

  it('reads a reply only once the turn is over', () => {
    expect(replyAfter({ messages: [{ role: 'assistant', text: 'old', timestamp: 1 }] }, 100_000)).toBeNull()
    expect(replyAfter({ messages: [{ role: 'assistant', text: '', tool_calls: [{ id: 'x' }], timestamp: 200 }] }, 100_000)).toBeNull()
    expect(replyAfter({ messages: [{ role: 'tool', text: 'x', timestamp: 200 }] }, 100_000)).toBeNull()
    expect(replyAfter({ messages: [{ role: 'assistant', content: [{ text: 'Done ' }, { text: 'now' }], timestamp: 200 }] }, 100_000)).toBe('Done now')
  })
})

describe('a follow-up whose redirect may have landed', () => {
  it('reports unknown for a dropped redirect, not_sent before a frame left', async () => {
    const timeout = setup(false, 'redirected', Object.assign(new Error('request timed out'), { name: 'TimeoutError' }))
    await timeout.jobs.start('Check the render')
    expect(await timeout.jobs.followUp('job-1', 'one more')).toMatchObject({ status: 'unknown' })
    const refused = setup(false, 'redirected', new GatewayError('refused', -32000))
    await refused.jobs.start('Check the render')
    expect(await refused.jobs.followUp('job-1', 'one more')).toMatchObject({ status: 'not_sent' })
    const dropped = setup(false, 'redirected', new Error('WebSocket closed'))
    await dropped.jobs.start('Check the render')
    expect(await dropped.jobs.followUp('job-1', 'one more')).toMatchObject({ status: 'unknown' })
    const offline = setup(false, 'redirected', new Error('Not connected to Hermes.'))
    await offline.jobs.start('Check the render')
    expect(await offline.jobs.followUp('job-1', 'one more')).toMatchObject({ status: 'not_sent' })
    const farHost = setup(false, 'redirected', new Error('Not connected to that Hermes.'))
    await farHost.jobs.start('Check the render')
    expect(await farHost.jobs.followUp('job-1', 'one more')).toMatchObject({ status: 'not_sent' })
    expect(correctionMayHaveGone(new Error('WebSocket closed'))).toBe(true)
    expect(correctionMayHaveGone(new Error('Not connected to Hermes.'))).toBe(false)
    expect(correctionMayHaveGone(new Error('Not connected to that Hermes.'))).toBe(false)
  })
})
