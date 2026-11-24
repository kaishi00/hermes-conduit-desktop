import { describe, expect, it } from 'vitest'
import { catchUpStep, newestRowId, tipOf } from '../src/renderer/src/state/chatCatchUp'

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
