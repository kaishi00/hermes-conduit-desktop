import { describe, expect, it } from 'vitest'
import { boardFrom, dialable, mailtoLink, people, placeBoards, sameBoards, share, smsLink, textRecipient } from '../src/renderer/src/state/boards'
import { namingFiles, splitReply, withoutBoardLines } from '../src/renderer/src/state/media'
import { copyableReply, sameQuotedText } from '../src/renderer/src/state/quote'
import { addPendingUser, applyEvent, emptyTranscript } from '../src/renderer/src/state/transcript'
import type { TranscriptItem, TranscriptState } from '../src/renderer/src/state/transcript'

const stats = { type: 'stats', title: 'Today', stats: [{ label: 'Steps', value: '8,412' }] }
const map = { type: 'map', title: 'Route', places: [] }

describe('a queued prompt between a board and its reply (issue 550)', () => {
  it('keeps a prompt queued through the running turn’s reply events (real applyEvent sequence)', () => {
    const board = { ...stats, cards: [stats], tabs: false, next: [], line: 'cb-000000000003' }
    let state: TranscriptState = {
      ...emptyTranscript,
      items: [{ kind: 'tool', key: 't1', name: 'conduit_show', status: 'done', board } as unknown as TranscriptItem]
    }
    state = applyEvent(state, { type: 'message.start', payload: {} })
    state = addPendingUser(state, 'then order a cab', [], 'u-real')
    state = applyEvent(state, { type: 'message.delta', payload: { text: 'Here:\n::conduit-board{id="cb-000000000003"}' } })
    state = applyEvent(state, { type: 'message.complete', payload: { text: 'Here:\n::conduit-board{id="cb-000000000003"}' } })
    // The queued prompt is still queued, so the board belongs to the earlier turn's reply.
    expect(state.items.find(i => i.key === 'u-real')).toMatchObject({ pending: true })
    const assistant = state.items.find(i => i.kind === 'assistant')!
    const placed = placeBoards(state.items)
    expect(placed.hidden).toEqual(new Set(['t1']))
    expect(placed.placed?.get(assistant.key)?.map(b => b.id)).toEqual(['cb-000000000003'])
  })

  it('does not end the turn for a prompt still waiting on the gateway', () => {
    const board = { ...stats, cards: [stats], tabs: false, next: [], line: 'cb-000000000001' }
    const withQueued = placeBoards([
      { kind: 'tool', key: 't1', board },
      { kind: 'user', key: 'u1', text: 'then do it', pending: true },
      { kind: 'assistant', key: 'a1', text: 'Here:\n::conduit-board{id="cb-000000000001"}' }
    ])
    expect(withQueued.hidden).toEqual(new Set(['t1']))
    expect(withQueued.placed?.get('a1')?.map(b => b.id)).toEqual(['cb-000000000001'])
    // A confirmed prompt still starts a new turn and leaves the earlier board at its row.
    const confirmed = placeBoards([
      { kind: 'tool', key: 't1', board },
      { kind: 'user', key: 'u1', text: 'then do it' },
      { kind: 'assistant', key: 'a1', text: 'Here:\n::conduit-board{id="cb-000000000001"}' }
    ])
    expect(confirmed.hidden?.size ?? 0).toBe(0)
    expect(confirmed.placed?.size ?? 0).toBe(0)
  })
})

describe('boards', () => {
  it('draws a board of kinds it knows, with its tabs and follow-ups', () => {
    const board = boardFrom(
      'conduit_show',
      JSON.stringify({ ok: true, cards: [stats, { type: 'callout', callout: { text: 'Hi' } }], layout: 'tabs', next: ['More', 'Less'], markdown: '**Today**' }),
      undefined
    )
    expect(board).toMatchObject({ tabs: true, next: ['More', 'Less'], markdown: '**Today**' })
    expect(board!.cards.map(c => c.type)).toEqual(['stats', 'callout'])
  })

  it('shows the Markdown whole when any card is one it can’t draw', () => {
    const board = boardFrom('conduit_show', { ok: true, cards: [stats, map], markdown: '## Route\n::conduit-board{id="cb-1"}\n' }, undefined)
    expect(board).toMatchObject({ cards: [], markdown: '## Route' })
  })

  it('is no board for another tool, a Markdown-only show or Markdown meant for the reply', () => {
    expect(boardFrom('terminal', { cards: [stats] }, undefined)).toBeNull()
    expect(boardFrom('conduit_show', { ok: true, note: 'shown' }, undefined)).toBeNull()
    expect(boardFrom('conduit_show', { ok: false, error: 'not_conduit', markdown: '# x' }, { cards: [stats] })).toBeNull()
    expect(boardFrom('conduit_show', 'not json', undefined)).toBeNull()
  })

  it('takes the call’s cards when an answer that succeeded doesn’t carry them', () => {
    expect(boardFrom('conduit_show', { ok: true }, { cards: [stats] })!.cards).toHaveLength(1)
  })

  it('fills a progress bar from a value and its goal, or a share', () => {
    expect(share(5, 10)).toBe(0.5)
    expect(share(0.25, undefined)).toBe(0.25)
    expect(share(40, undefined)).toBe(0.4)
    expect(share(30, 10)).toBe(1)
  })

  it('draws a contact card, with the text Hermes wrote for the user to send', () => {
    const card = {
      type: 'contact',
      people: [
        { name: 'Mia Chen', detail: 'Wife', phone: '(+44) 7700 900123', message: 'Your flight landed!', photo: { url: 'https://x.test/m.jpg' } },
        { name: 'Sam', email: 'sam@example.com', message: 'Hi', url: 'javascript:alert(1)' },
        { name: '  ', phone: '123' }
      ]
    }
    expect(boardFrom('conduit_show', { ok: true, cards: [card], markdown: 'fallback' }, undefined)?.cards).toHaveLength(1)
    const [mia, sam] = people(card)
    expect(people(card)).toHaveLength(2)
    expect(mia).toMatchObject({ name: 'Mia Chen', detail: 'Wife', photo: 'https://x.test/m.jpg' })
    expect(sam!.url).toBeUndefined()
    expect(dialable(mia!.phone)).toBe('+447700900123')
    expect(dialable('555-0100')).toBe('5550100')
    expect(textRecipient(mia!)).toBe('+447700900123')
    expect(textRecipient(sam!)).toBe('sam@example.com')
    expect(smsLink('+447700900123')).toBe('sms:+447700900123')
    expect(smsLink('a@b.c&body=hi')).toBe('sms:a@b.c%26body%3Dhi')
    expect(mailtoLink('a@b.c?cc=x')).toBe('mailto:a@b.c%3Fcc%3Dx')
  })

  // Phone issue 3215: conduit_show's answer names its board's line, and a reply that writes it draws the board there.
  const id = 'cb-0123456789ab'
  const line = `::conduit-board{id="${id}"}`
  const shown = boardFrom('conduit_show', { ok: true, directive: line, cards: [stats], next: ['More'], markdown: '**Today**' }, undefined)!
  const user = { kind: 'user', key: 'u1', text: 'Compare them' }
  const row = { kind: 'tool', key: 't1', board: shown }
  const reply = (key: string, text: string) => ({ kind: 'assistant', key, text })

  it('reads the line a board’s answer names', () => {
    expect(shown.line).toBe(id)
    expect(boardFrom('conduit_show', { ok: true, cards: [stats] }, undefined)!.line).toBeUndefined()
    expect(boardFrom('conduit_show', { ok: true, directive: '::conduit-board{id="nope"}', cards: [stats] }, undefined)!.line).toBeUndefined()
  })

  it('gives a board to the reply of its turn that writes its line, and leaves its row out', () => {
    const placement = placeBoards([user, row, reply('a1', `First the plan.\n\n${line}\n\nThen the rest.`)])
    expect([...placement.hidden]).toEqual(['t1'])
    expect(placement.placed.get('a1')).toEqual([{ id, board: shown, key: 't1' }])
    // While the line is still being written the board stays at its row.
    expect(placeBoards([user, row, reply('a1', 'First the plan.\n\n::conduit-board{id="cb-0123')]).hidden.size).toBe(0)
    // The first reply of the turn to name it takes it.
    const twice = placeBoards([user, row, reply('a1', line), reply('a2', `Again ${line}`)])
    expect([...twice.placed.keys()]).toEqual(['a1'])
    // A steer between the board and the reply is part of the same turn.
    const steered = placeBoards([user, row, { kind: 'user', key: 'u2', text: 'Shorter', steer: true }, reply('a1', line)])
    expect([...steered.hidden]).toEqual(['t1'])
  })

  it('leaves a board at its row without the line, for a later turn’s line, or for an example', () => {
    expect(placeBoards([user, row, reply('a1', 'Here it is.')]).hidden.size).toBe(0)
    expect(placeBoards([user, row, reply('a1', 'Here.'), { kind: 'user', key: 'u2', text: 'And?' }, reply('a2', line)]).hidden.size).toBe(0)
    for (const example of ['```\n' + line + '\n```', `> ${line}`, `\`${line}\``, `| ${line} | x |`])
      expect(placeBoards([user, row, reply('a1', example)]).hidden.size).toBe(0)
  })

  it('cuts the reply where the line was, the words on that line before the board', () => {
    const boards = new Set([id])
    expect(splitReply(`First the plan.\n\n${line}\n\nThen the rest.`, boards)).toEqual([
      { kind: 'markdown', text: 'First the plan.\n' },
      { kind: 'board', id },
      { kind: 'markdown', text: '\nThen the rest.' }
    ])
    expect(splitReply(`See ${line}\nmore\n${line}`, boards)).toEqual([
      { kind: 'markdown', text: 'See' },
      { kind: 'board', id },
      { kind: 'markdown', text: `more\n${line}` }
    ])
    expect(splitReply(line, boards)).toEqual([{ kind: 'board', id }])
    // Two boards on one line: the words between them stay between them.
    const other = 'cb-0123456789ff'
    expect(splitReply(`A ${line} mid ::conduit-board{id="${other}"} end`, new Set([id, other]))).toEqual([
      { kind: 'markdown', text: 'A' },
      { kind: 'board', id },
      { kind: 'markdown', text: 'mid' },
      { kind: 'board', id: other },
      { kind: 'markdown', text: 'end' }
    ])
  })

  it('leaves the line out of what is copied, quoted or handed to a live model', () => {
    expect(withoutBoardLines(`First.\n\n${line}\n\nThen.`)).toBe('First.\n\nThen.')
    expect(withoutBoardLines(`See ${line} here`)).toBe('See here')
    expect(withoutBoardLines('```\n' + line + '\n```')).toBe('```\n' + line + '\n```')
    expect(copyableReply(`First.\n\n${line}\n\nThen.`)).toBe('First.\n\nThen.')
    expect(namingFiles(`First.\n${line}`)).toBe('First.')
    // A quote of the reply is found again by the reply's words without the line.
    const raw = `First.\n\n${line}\n\nThen.`
    expect(sameQuotedText(withoutBoardLines(raw), withoutBoardLines(raw))).toBe(true)
    expect(sameQuotedText(raw, withoutBoardLines(raw))).toBe(false)
    // A line in a quote or a table stays, as the reply draws it.
    expect(withoutBoardLines(`> ${line}`)).toBe(`> ${line}`)
    // The first call of a turn to name an id keeps it.
    const again = { ...row, key: 't2' }
    expect([...placeBoards([user, row, again, reply('a1', line)]).hidden]).toEqual(['t1'])
    expect(splitReply(`Before\n${line}`)).toEqual([{ kind: 'markdown', text: `Before\n${line}` }])
  })

  it('tells two lists of the same placed boards as one', () => {
    const one = placeBoards([user, row, reply('a1', line)]).placed.get('a1')
    const two = placeBoards([user, row, reply('a1', line)]).placed.get('a1')
    expect(one).not.toBe(two)
    expect(sameBoards(one, two)).toBe(true)
    expect(sameBoards(one, undefined)).toBe(false)
    expect(sameBoards(undefined, undefined)).toBe(true)
  })
})
