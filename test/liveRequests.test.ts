import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import { answerApproval, answerQuestion, answerWords, delegatedAnswer, isApprove, isDeny, pickedChoices, questionOpen, requestUpdate, unmarkedAnswer } from '../src/renderer/src/state/liveRequests'

const approval = (id = 'a1'): PendingRequest => ({
  id,
  method: 'approval',
  sessionId: 's',
  params: { description: 'Delete the build folder', command: 'rm -rf build' },
  receivedAt: 0
})
const clarify = (id = 'q1'): PendingRequest => ({
  id,
  method: 'clarify',
  sessionId: 's',
  params: {
    questions: [
      { qid: 'one', question: 'Which city?', choices: ['Paris', 'Rome'] },
      { qid: 'two', question: 'Which toppings?', choices: ['Ham', 'Olives', 'Basil'], multi_select: true }
    ]
  },
  receivedAt: 0
})

function stubConduit(rpc: (method: string, params: Record<string, unknown>) => unknown = () => ({ status: 'ok', remaining: ['two'] })) {
  const conduit = {
    answerRequest: vi.fn(async () => true),
    dismissRequest: vi.fn(async () => undefined),
    rpcOutcome: vi.fn(async (method: string, params: Record<string, unknown>) => ({ ok: true, result: rpc(method, params) }))
  }
  vi.stubGlobal('window', { conduit })
  return conduit
}

afterEach(() => vi.unstubAllGlobals())

describe('answering the chat by voice', () => {
  it('tells the model what Hermes waits on', () => {
    expect(requestUpdate(approval())).toBe(
      "[Conduit] Hermes needs the user's OK to go on: Delete the build folder (rm -rf build). Tell them what it asks to do and ask whether to allow it once."
    )
    expect(requestUpdate(clarify())).toBe('[Conduit] Hermes asks the user: Which city? Choices: 1. Paris; 2. Rome. Ask them, then answer with what they say.')
  })

  it('reads choice numbers, and words that are no number as the answer itself', () => {
    const [city, toppings] = [
      { qid: 'one', question: 'q', choices: ['Paris', 'Rome'], multiSelect: false },
      { qid: 'two', question: 'q', choices: ['Ham', 'Olives', 'Basil'], multiSelect: true }
    ]
    expect(pickedChoices('2', city)).toEqual(['Rome'])
    expect(pickedChoices('1, 2', city)).toBeNull()
    expect(pickedChoices('1 and 3', toppings)).toEqual(['Ham', 'Basil'])
    expect(pickedChoices('4', city)).toBeNull()
    expect(pickedChoices('Berlin', city)).toBeNull()
  })

  it("takes an unmarked GPT-Live delegation as the answer while a question waits", () => {
    expect(questionOpen([clarify()])).toBe(true)
    expect(questionOpen([approval()])).toBe(false)
    expect(delegatedAnswer('Answer: 2', 'the second', [clarify()], false)).toBe('2')
    expect(delegatedAnswer('Answer:', ' Rome please ', [clarify()], false)).toBe('Rome please')
    expect(delegatedAnswer('', 'Rome please', [clarify()], true)).toBe('Rome please')
    expect(delegatedAnswer('The user picks Rome', 'Rome', [clarify()], true)).toBe('Rome')
    expect(delegatedAnswer('', 'yes', [approval()], true)).toBeNull()
    expect(delegatedAnswer('', '', [clarify()], true)).toBeNull()
    expect(delegatedAnswer('check the weather', 'check the weather', [], true)).toBeNull()
  })

  it("reads GPT-Live's markers", () => {
    expect(isApprove('Approve: yes')).toBe(true)
    expect(isDeny(' deny:')).toBe(true)
    expect(answerWords('Answer: 2')).toBe('2')
    expect(answerWords('Check my mail')).toBeNull()
  })

  it("answers the chat's approval only with once or deny", async () => {
    const conduit = stubConduit()
    expect(await answerApproval([], 'once')).toMatchObject({ status: 'error' })
    expect(await answerApproval([approval()], 'always')).toMatchObject({ status: 'error' })
    expect(conduit.answerRequest).not.toHaveBeenCalled()
    expect(await answerApproval([clarify(), approval()], 'once')).toMatchObject({ status: 'sent' })
    expect(conduit.answerRequest).toHaveBeenCalledWith('a1', { choice: 'once' })
    conduit.answerRequest.mockResolvedValueOnce(false)
    expect(await answerApproval([approval()], 'deny')).toMatchObject({ status: 'error', error: 'It was already answered somewhere else.' })
  })

  it('locks one question at a time and hands back the next', async () => {
    const locks: Record<string, unknown>[] = []
    const conduit = stubConduit((_m, params) => {
      locks.push(params)
      return { status: 'ok', remaining: locks.length === 1 ? ['two'] : [] }
    })
    const request = clarify('q2')
    const first = await answerQuestion([request], '2')
    expect(first.status).toBe('answered')
    expect(first.next_question).toContain('Which toppings?')
    expect(await answerQuestion([request], '1, 3')).toEqual({ status: 'answered', message: 'Hermes has the answer and goes on.' })
    expect(locks).toEqual([
      { request_id: 'q2', question_id: 'one', answer: 'Rome' },
      { request_id: 'q2', question_id: 'two', answer: ['Ham', 'Basil'] }
    ])
    expect(conduit.dismissRequest).toHaveBeenCalledWith('q2')
    expect(await answerQuestion([request], '1')).toMatchObject({ status: 'error' })
    const other = clarify('q3')
    await answerQuestion([other], 'skip')
    expect(locks.at(-1)).toEqual({ request_id: 'q3', question_id: 'one', answer: null })
  })
})

describe('a delegation that marks nothing while a question waits (#602, #609)', () => {
  const base = { text: '', said: 'yes', held: false, answers: true, background: false }
  it('answers the question with the user’s words', () => {
    expect(unmarkedAnswer(base, [clarify()])).toBe('yes')
    expect(unmarkedAnswer(base, [approval()])).toBeNull()
  })
  it('leaves the question open while a request waits for the user’s OK: their yes is about the request', () => {
    expect(unmarkedAnswer({ ...base, held: true }, [clarify()])).toBeNull()
    expect(unmarkedAnswer({ ...base, held: true, text: 'Send:' }, [clarify()])).toBeNull()
  })
  it('keeps Call me work and work sent to the background as requests', () => {
    expect(unmarkedAnswer({ ...base, answers: false }, [clarify()])).toBeNull()
    expect(unmarkedAnswer({ ...base, text: 'check the logs in the background', background: true }, [clarify()])).toBeNull()
    // The user's words mentioning the background are still an answer.
    expect(unmarkedAnswer({ ...base, said: 'the job in the background failed' }, [clarify()])).toBe('the job in the background failed')
  })
})
