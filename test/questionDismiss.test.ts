// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import { settle } from './hookHarness'

vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: vi.fn(), rpc: vi.fn() } }))
const { gateway } = await import('../src/renderer/src/gateway')
const { parseQuestion } = await import('../src/renderer/src/state/work')
const { expiredFor, markExpired, resetExpiredQuestions } = await import('../src/renderer/src/state/expiredQuestions')
type AskedIn = import('../src/renderer/src/state/expiredQuestions').AskedIn
type WorkQuestion = import('../src/renderer/src/state/work').WorkQuestion

const http = gateway.http as unknown as ReturnType<typeof vi.fn>

type CardProps = { question: WorkQuestion; profile?: string; onChanged: () => void; askedIn?: AskedIn }
let QuestionCard: ComponentType<CardProps>

beforeAll(async () => {
  Object.assign(window, {
    conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) })
  })
  // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
  const path = '../src/renderer/src/components/WorkPanel.tsx'
  ;({ QuestionCard } = (await import(/* @vite-ignore */ path)) as { QuestionCard: ComponentType<CardProps> })
})

/** The plugin's row for a kept clarify question, as the Work panel reads it. */
const row = { id: 'P7', kind: 'proposal', status: 'open', refs: ['W3'], title: 'Fix the build', text: 'Run the fix?', at: 1, actions: ['answer', 'dismiss'], choices: ['Yes', 'No'], chat: 'c1' }
/** The card Hermes stopped waiting for, with the request's own shape: a batch of two. */
const kept = (id: string, sessionId: string): PendingRequest => ({
  id,
  method: 'clarify',
  sessionId,
  params: { questions: [{ qid: 'q1', question: 'Run the fix?', choices: ['Yes', 'No'] }, { qid: 'q2', question: 'Which branch?' }] },
  receivedAt: 1
})

describe("the Work panel's Dismiss question (#376)", () => {
  beforeEach(() => {
    http.mockReset()
    resetExpiredQuestions()
  })

  it("posts the dismissal, then takes that question off its own chat's kept card only", async () => {
    const question = parseQuestion(row)!
    expect(question).toMatchObject({ id: 'P7', text: 'Run the fix?', chat: 'c1' })
    markExpired(kept('a', 'live-1'))
    markExpired(kept('b', 'live-2'))
    http.mockResolvedValue({ ok: true })
    const changed = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(QuestionCard, { question, profile: 'furina', onChanged: changed, askedIn: { live: 'live-1' } })))

    const dismiss = host.querySelector('.work-question-dismiss') as HTMLButtonElement
    expect(dismiss).not.toBeNull()
    act(() => dismiss.click())
    await settle()

    expect(http).toHaveBeenCalledTimes(1)
    expect(http.mock.calls[0]![0]).toBe('POST')
    expect(http.mock.calls[0]![1]).toContain('/P7/dismiss')
    expect(changed).toHaveBeenCalledTimes(1)
    // Its chat's card keeps the batch's other question; the other chat's card is untouched.
    expect(expiredFor('live-1').map(e => e.dismissed)).toEqual([['Run the fix?']])
    expect(expiredFor('live-2').map(e => e.dismissed)).toEqual([undefined])
    act(() => root.unmount())
  })

  it('keeps the card when the dismissal is refused', async () => {
    markExpired(kept('a', 'live-1'))
    http.mockRejectedValue(new Error('not now'))
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(QuestionCard, { question: parseQuestion(row)!, onChanged: () => undefined, askedIn: { live: 'live-1' } })))
    act(() => (host.querySelector('.work-question-dismiss') as HTMLButtonElement).click())
    await settle()
    expect(expiredFor('live-1').map(e => e.dismissed)).toEqual([undefined])
    act(() => root.unmount())
  })
})
