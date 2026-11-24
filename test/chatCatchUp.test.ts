import { describe, expect, it } from 'vitest'
import { catchUpStep, newestRowId, readOver, tipOf } from '../src/renderer/src/state/chatCatchUp'
import { emptyTranscript, olderPagesOf, prependOlder } from '../src/renderer/src/state/transcript'

describe('tipOf', () => {
  it('is the newest row id, whatever order the rows come in', () => {
    expect(tipOf([{ role: 'user', row_id: 4 }, { role: 'assistant', row_id: 9 }, { role: 'tool', row_id: 7 }])).toBe(9)
  })

  it('is null when no row carries an id', () => {
    expect(tipOf([{ role: 'user' }, { role: 'assistant', row_id: null }])).toBeNull()
    expect(tipOf([])).toBeNull()
    expect(tipOf(undefined)).toBeNull()
  })
})

describe('newestRowId', () => {
  it('asks for one row of the chat, in its profile, and reads the id the REST route names `id`', async () => {
    const paths: string[] = []
    const http = async (_method: 'GET', path: string) => {
      paths.push(path)
      return { messages: [{ role: 'assistant', id: 41 }] }
    }
    expect(await newestRowId(http, 'chat a', 'work')).toBe(41)
    expect(paths).toEqual(['/api/sessions/chat%20a/messages?order=latest&limit=1&include_compacted=true&inline_images=false&profile=work'])
  })

  it('names no profile for the default one, and answers null for a chat with no rows', async () => {
    const paths: string[] = []
    const http = async (_method: 'GET', path: string) => {
      paths.push(path)
      return { messages: [] }
    }
    expect(await newestRowId(http, 'c', 'default')).toBeNull()
    expect(paths[0]).not.toContain('profile=')
  })
})

describe('catchUpStep', () => {
  it('reads the chat again when a row it never drew was stored by another process', () => {
    expect(catchUpStep(12, 10, false)).toBe('reload')
  })

  it('takes the rows a turn followed here stored as drawn', () => {
    expect(catchUpStep(12, 10, true)).toBe('adopt')
  })

  it('does nothing when the newest row is one it drew', () => {
    expect(catchUpStep(10, 10, false)).toBe('none')
    expect(catchUpStep(9, 10, true)).toBe('none')
  })

  it('only learns the newest row when it knew none (a chat made here, an older Hermes)', () => {
    expect(catchUpStep(12, null, false)).toBe('adopt')
    expect(catchUpStep(null, 10, false)).toBe('none')
    expect(catchUpStep(null, null, true)).toBe('none')
  })
})

describe('readOver', () => {
  const row = (key: string, pending = false) => ({ kind: 'user' as const, key, text: key, at: 0, ...(pending ? { pending } : {}) })

  it('says a chat at rest can be read again', () => {
    expect(readOver({ ...emptyTranscript, items: [row('row-1')] })).toBe(false)
  })

  it('leaves a running turn, a message in the dock and a send on its way alone', () => {
    expect(readOver({ ...emptyTranscript, running: true })).toBe(true)
    expect(readOver({ ...emptyTranscript, held: [{ admission: 'a1', item: row('q1') }] })).toBe(true)
    expect(readOver({ ...emptyTranscript, items: [row('u1', true)] })).toBe(true)
  })
})

describe('olderPagesOf', () => {
  const note = { kind: 'notice' as const, key: 'long-chat', text: 'long', tone: 'info' as const }
  const rows = (...ids: number[]) => ids.map(id => ({ kind: 'user' as const, key: `row-${id}`, text: String(id), at: 0 }))

  it('keeps the pages read above the newest page, and lands them under the note', () => {
    const kept = { ...emptyTranscript, items: [note, ...rows(1, 2, 3, 4)] }
    const fresh = { ...emptyTranscript, items: [note, ...rows(3, 4, 5)] }
    const pages = olderPagesOf(kept, fresh)
    expect(pages.map(item => item.key)).toEqual(['row-1', 'row-2'])
    expect(prependOlder(fresh, pages).items.map(item => item.key)).toEqual(['long-chat', 'row-1', 'row-2', 'row-3', 'row-4', 'row-5'])
  })

  it('keeps nothing of a chat with no pages read, or one the new page no longer reaches', () => {
    expect(olderPagesOf({ ...emptyTranscript, items: rows(3, 4) }, { ...emptyTranscript, items: rows(3, 4, 5) })).toEqual([])
    expect(olderPagesOf({ ...emptyTranscript, items: rows(1, 2) }, { ...emptyTranscript, items: rows(8, 9) })).toEqual([])
  })
})
