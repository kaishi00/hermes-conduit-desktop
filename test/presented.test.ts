import { describe, expect, it } from 'vitest'
import {
  answerResult,
  askerLine,
  canConfirm,
  declineLabel,
  exchange,
  insteadLabel,
  isAsk,
  parsePrompt,
  withResult,
  type ConfirmResult,
  type ResultsStore
} from '../src/renderer/src/state/presented'

const memory = (): ResultsStore & { all: Record<string, ConfirmResult[]> } => {
  const all: Record<string, ConfirmResult[]> = {}
  return { all, read: scope => all[scope] ?? [], write: (scope, list) => void (list.length ? (all[scope] = list) : delete all[scope]) }
}

describe('what Hermes waits on', () => {
  it('reads a confirmation, a room’s ask, Run work’s and a Link’s', () => {
    const plain = parsePrompt({ id: 'p1', title: ' Send the email ', preview: 'To Bo', action_label: 'Send', session_id: 's1', expires_at: 99 })!
    expect(plain).toMatchObject({ id: 'p1', title: 'Send the email', actionLabel: 'Send', sessionId: 's1', room: null, link: null })
    expect(isAsk(plain)).toBe(false)
    expect(askerLine(plain)).toBe('Hermes asks')
    expect(declineLabel(plain)).toBe('Not now')
    expect(parsePrompt({ id: 'x', title: 't' })!.actionLabel).toBe('Confirm')
    expect(parsePrompt({ id: 'x', title: ' ' })).toBeNull()

    const room = parsePrompt({ id: 'p2', title: 'Share your trip dates?', action_label: 'Share', room: { id: 'r', name: 'Weekend hike' } })!
    expect(askerLine(room)).toBe('Asked in Weekend hike')
    expect(declineLabel(room)).toBe("Don't share")
    expect(insteadLabel(room)).toBe('Say instead')

    const work = parsePrompt({ id: 'p3', title: 'Start the report?', action_label: 'Start', room: { id: 'r', name: '', work: true } })!
    expect(askerLine(work)).toBe('Hermes asks')
    expect(declineLabel(work)).toBe("Don't start")
    expect(declineLabel({ ...work, actionLabel: 'Send' })).toBe('Not now')
    expect(insteadLabel(work)).toBe('Change it')

    const question = parsePrompt({ id: 'p4', title: 'Ana asks', link: { id: 'L', name: 'Ana', share: false } })!
    expect(askerLine(question)).toBe("Ana's Hermes asks")
    expect(canConfirm(question)).toBe(false)
    expect(declineLabel(question)).toBe("Don't answer")
    expect(askerLine(parsePrompt({ id: 'p5', title: 'q', link: 'garbled' })!)).toBe("A linked person's Hermes asks")
  })

  it('answers once, with Say instead’s words, never a Share with nothing to share', () => {
    const question = parsePrompt({ id: 'p4', title: 'q', link: { id: 'L', name: 'Ana', share: false } })!
    expect(answerResult(question, 'confirmed')).toBeNull()
    expect(answerResult(question, 'edit', '  Friday works  ')).toEqual({ id: 'p4', outcome: 'edit', via: 'tap', edit_text: 'Friday works' })
    expect(answerResult(question, 'declined')).toEqual({ id: 'p4', outcome: 'declined', via: 'tap' })
    expect(withResult([{ id: 'a', outcome: 'declined', via: 'tap' }], { id: 'a', outcome: 'confirmed', via: 'tap' })).toEqual([{ id: 'a', outcome: 'confirmed', via: 'tap' }])
  })

  it('exchanges: sends the answers, drops them once sent, and leaves out what it answered', async () => {
    const store = memory()
    store.write('h|work', [{ id: 'done', outcome: 'confirmed', via: 'tap' }])
    const calls: unknown[] = []
    const prompts = await exchange(
      async (path, body) => {
        calls.push([path, body])
        return { ok: true, prompts: [{ id: 'done', title: 'Old' }, { id: 'new', title: 'New' }, { id: 'gone', title: 'Gone', expires_at: 1 }] }
      },
      store,
      'h|work',
      'work',
      { installationId: 'desktop-abc12345', name: 'Conduit for Mac', version: '0.1.0' }
    )
    expect(prompts.map(p => p.id)).toEqual(['new'])
    expect(store.all).toEqual({})
    expect(calls).toEqual([
      [
        '/api/plugins/conduit_push/present/exchange?profile=work',
        {
          installation_id: 'desktop-abc12345',
          device: 'Conduit for Mac',
          app_version: '0.1.0',
          results: [{ id: 'done', outcome: 'confirmed', via: 'tap' }],
          features: ['room-asks', 'link-asks', 'room-work', 'pc-asks']
        }
      ]
    ])
    await expect(exchange(async () => ({ ok: false }), store, 's', 'default', { installationId: 'desktop-x1234567', name: 'n', version: 'v' })).rejects.toThrow()
  })
})
