// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChat } from '../src/renderer/src/state/useChat'
import { forgetTranscripts } from '../src/renderer/src/state/transcriptCache'
import { forgetChatLengths } from '../src/renderer/src/state/chatLength'
import { useTranscript } from '../src/renderer/src/state/transcriptStore'
import { noLiveWork, type LiveWork } from '../src/renderer/src/state/liveWork'

type Event = { type: string; session_id?: string; payload?: unknown }
let calls: string[] = []

beforeEach(() => {
  forgetTranscripts()
  forgetChatLengths()
  calls = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (method: string, params: Record<string, unknown>) => {
      calls.push(method)
      if (method === 'session.resume') {
        const id = String(params.session_id)
        return Promise.resolve({ ok: true, result: { session_id: `live-${id}`, stored_session_id: id, messages: [] } })
      }
      if (method === 'prompt.submit') return Promise.resolve({ ok: true, result: { status: 'queued', admission_id: 'adm-1', forwarded: true } })
      return Promise.resolve({ ok: true, result: {} })
    },
    httpOutcome: async () => ({ ok: false, error: 'none', code: 404 }),
    onEvent: (_listener: (event: Event) => void) => () => undefined
  }
})

let mounted: { unmount: () => void }[] = []
afterEach(() => {
  mounted.forEach(hook => hook.unmount())
  mounted = []
})

const chatHook = () => {
  const chat = useChat('a', undefined, false, true, false, undefined, 'h1', undefined)
  return { ...chat, transcript: useTranscript(chat.transcriptStore) }
}
const userWords = (state: { items: { kind: string; text?: string }[] }) => state.items.filter(i => i.kind === 'user').map(i => i.text)
const queued = (admissionId: string): LiveWork['queued'][number] => ({
  admissionId, inputId: '', text: 'later', status: 'queued', sequence: 1, canSendNow: false, canEdit: false, steering: false, readOnly: true
})

describe("applyLiveWork on hermes dashboard", () => {
  it('keeps a forwarded send in the dock until a read asked after it no longer lists it', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    const before = Date.now() - 1000
    await act(async () => {
      await hook.result().send('later')
    })
    expect(hook.result().queue.map(r => r.admissionId)).toEqual(['adm-1'])
    expect(userWords(hook.result().transcript)).toEqual([])
    // A read asked before the send can't know it: the row stays and the bubble stays held.
    act(() => hook.result().applyLiveWork({ ...noLiveWork, running: true }, noLiveWork, before))
    expect(hook.result().queue.map(r => r.admissionId)).toEqual(['adm-1'])
    expect(userWords(hook.result().transcript)).toEqual([])
    // A later read that lists it keeps it; one that doesn't starts its turn.
    act(() => hook.result().applyLiveWork({ ...noLiveWork, running: true, queued: [queued('adm-1')] }, noLiveWork, Date.now() + 1))
    expect(hook.result().queue.map(r => r.admissionId)).toEqual(['adm-1'])
    act(() => hook.result().applyLiveWork({ ...noLiveWork, running: true, started: ['adm-1'] }, noLiveWork, Date.now() + 1))
    expect(hook.result().queue).toEqual([])
    expect(userWords(hook.result().transcript)).toEqual(['later'])
  })

  it('keeps a Beside send forwarded behind a gateway turn in its chat, with no dock row', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    await act(async () => {
      await hook.result().send('later', [], undefined, { noDock: true })
    })
    expect(hook.result().queue).toEqual([])
    expect(userWords(hook.result().transcript)).toEqual(['later'])
  })

  it('lets go of a forwarded send that left the queue without running now, and reads the history', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    await act(async () => {
      await hook.result().send('later')
    })
    const resumes = calls.filter(c => c === 'session.resume').length
    await act(async () => {
      hook.result().applyLiveWork({ ...noLiveWork, running: true, started: ['someone-else'] }, noLiveWork, Date.now() + 1)
      await settle()
    })
    expect(hook.result().queue).toEqual([])
    expect(userWords(hook.result().transcript)).toEqual([])
    expect(calls.filter(c => c === 'session.resume').length).toBeGreaterThan(resumes)
  })

  it('reads the history again once when the gateway turn it followed ends', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    const resumes = () => calls.filter(c => c === 'session.resume').length
    const opened = resumes()
    await act(async () => {
      hook.result().applyLiveWork(noLiveWork, { ...noLiveWork, running: true }, Date.now())
      await settle()
    })
    expect(resumes()).toBeGreaterThan(opened)
  })

  it("brings in a queued message's words when its turn starts and nothing here holds it", async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    // Reopened while it waited: the dock row came from the read, no bubble is held.
    const listed = { ...noLiveWork, running: true, queued: [queued('adm-7')] }
    act(() => hook.result().applyLiveWork(listed, noLiveWork, Date.now() + 1))
    expect(userWords(hook.result().transcript)).toEqual([])
    const turn = { ...noLiveWork, running: true, started: ['adm-7'] }
    act(() => hook.result().applyLiveWork(turn, listed, Date.now() + 1))
    expect(userWords(hook.result().transcript)).toEqual(['later'])
    // Once: the next read naming it again draws nothing more.
    act(() => hook.result().applyLiveWork(turn, listed, Date.now() + 1))
    expect(userWords(hook.result().transcript)).toEqual(['later'])
  })

  it("draws a queued message's words once, even after the history is read again", async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    const listed = { ...noLiveWork, running: true, queued: [queued('adm-7')] }
    const turn = { ...noLiveWork, running: true, started: ['adm-7'] }
    act(() => hook.result().applyLiveWork(turn, listed, Date.now() + 1))
    expect(userWords(hook.result().transcript)).toEqual(['later'])
    // The turn ends: the history is read again (its stored rows), and the transcript is rebuilt from them.
    await act(async () => {
      hook.result().applyLiveWork(noLiveWork, turn, Date.now() + 1)
      await settle()
    })
    // A read still pairing the old listing with the running turn draws nothing more.
    act(() => hook.result().applyLiveWork(turn, listed, Date.now() + 1))
    expect(userWords(hook.result().transcript)).toEqual([])
  })

  it('reads the history again when a queued message nothing holds left the queue without running', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    const resumes = () => calls.filter(c => c === 'session.resume').length
    const listed = { ...noLiveWork, running: true, queued: [queued('adm-7')] }
    act(() => hook.result().applyLiveWork(listed, noLiveWork, Date.now() + 1))
    const opened = resumes()
    await act(async () => {
      hook.result().applyLiveWork(noLiveWork, { ...listed, running: false }, Date.now() + 1)
      await settle()
    })
    expect(resumes()).toBeGreaterThan(opened)
  })

  it('waits for the turn to end before reading history for a queued message nothing holds', async () => {
    const hook = renderHook(chatHook, {})
    mounted.push(hook)
    await settle()
    const resumes = () => calls.filter(c => c === 'session.resume').length
    const listed = { ...noLiveWork, running: true, queued: [queued('adm-7')] }
    act(() => hook.result().applyLiveWork(listed, noLiveWork, Date.now() + 1))
    const opened = resumes()
    await act(async () => {
      // It left the queue while a turn runs here: drawing a bubble now would drop the read-drawn one.
      hook.result().applyLiveWork({ ...noLiveWork, running: true }, listed, Date.now() + 1)
      await settle()
    })
    expect(resumes()).toBe(opened)
    await act(async () => {
      hook.result().applyLiveWork(noLiveWork, { ...noLiveWork, running: true }, Date.now() + 1)
      await settle()
    })
    expect(resumes()).toBeGreaterThan(opened)
  })

})
