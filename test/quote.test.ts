import { describe, expect, it } from 'vitest'
import {
  blockquote,
  carriesReply,
  copyableReply,
  excerpt,
  insertQuote,
  parseReplyEnvelope,
  parseRoomReply,
  replyEnvelope,
  roomReplyText,
  sameQuotedText
} from '../src/renderer/src/state/quote'

describe('quoting words', () => {
  it('quotes each line, keeps blank lines in the quote, and drops the edges', () => {
    expect(blockquote('\n  one  \n\n  two\n\n')).toBe('>   one\n>\n>   two')
    expect(blockquote(' \n ')).toBe('')
  })

  it('goes after what is typed, with room for the reply', () => {
    expect(insertQuote('> a', '')).toBe('> a\n\n')
    expect(insertQuote('> a', 'hi  \n')).toBe('hi\n\n> a\n\n')
    expect(insertQuote('', 'hi')).toBe('hi')
  })
})

describe('replying to a whole reply', () => {
  it('travels as the phone sends it and reads back as a card', () => {
    const sent = replyEnvelope('First line\n\nSecond', 'Thanks!')
    expect(sent).toBe('[Replying to your earlier message]\n> First line\n>\n> Second\n\nThanks!')
    expect(parseReplyEnvelope(sent)).toEqual({ quote: 'First line\n\nSecond', message: 'Thanks!' })
    expect(parseReplyEnvelope('[Replying to your earlier message]\nno quote')).toBeNull()
    expect(parseReplyEnvelope('hello')).toBeNull()
    expect(replyEnvelope('  ', 'hi')).toBe('hi')
  })

  it('waits for the next message when this one is a slash command', () => {
    expect(carriesReply('/retry', false)).toBe(false)
    expect(carriesReply('/retry', true)).toBe(true)
    expect(carriesReply('/', false)).toBe(true)
    expect(carriesReply('why?', false)).toBe(true)
  })

  it('finds the reply a card quoted by its words', () => {
    expect(sameQuotedText('One  \n\nTwo\n', 'One\n\nTwo')).toBe(true)
    expect(sameQuotedText('One', 'Two')).toBe(false)
    expect(sameQuotedText('', '')).toBe(false)
  })

  it('previews in a line without Markdown', () => {
    expect(excerpt('## Plan\n- **first** step\n```\ncode\n```\n1. `two`')).toBe('Plan first step code two')
    expect(excerpt('x'.repeat(300), 10)).toBe('xxxxxxxxxx…')
  })
})

describe('replying in a room', () => {
  it('names whose message it was and mentions nobody but who the user does', () => {
    const sent = roomReplyText('ask @Atlas', 'Nova [bot]\n', 'and you @Nova?')
    expect(sent).toBe('[Replying to Nova [bot) ]\n> ask @\u2060Atlas\n\nand you @Nova?')
    expect(parseRoomReply(sent)).toEqual({ author: 'Nova [bot) ', quote: 'ask @Atlas', message: 'and you @Nova?' })
    expect(parseRoomReply('[Replying to your earlier message]\n> x\n\ny')).toEqual({ author: 'your earlier message', quote: 'x', message: 'y' })
    expect(parseRoomReply('[Replying to ]\n> x')).toBeNull()
  })
})

describe('copying a reply', () => {
  it('keeps the words and names each file by its path', () => {
    expect(copyableReply('Here it is:\nMEDIA:/tmp/a.png\nDone.')).toBe('Here it is:\n\n/tmp/a.png\n\nDone.')

    // A `|` in ordinary prose is not a table row: its directive is still removed for Copy.
    expect(copyableReply('Pick A | B ::conduit-board{id="cb-000000000001"}')).toBe('Pick A | B')
    // A real table's row keeps its directive (the drawn reply keeps the row); a lone pipe line is prose.
    expect(copyableReply('| A | B |\n|---|---|\n| C | D ::conduit-board{id="cb-000000000001"} |')).toContain('::conduit-board{')
    expect(copyableReply('| A | B ::conduit-board{id="cb-000000000001"} |')).toBe('| A | B |')
  })
})
