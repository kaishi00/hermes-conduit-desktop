import { describe, expect, it } from 'vitest'
import { cleanUserText, previewText } from '../src/renderer/src/state/text'
import { applyEvent, emptyTranscript, fromHistory } from '../src/renderer/src/state/transcript'

const VOICE_BRIEF =
  '[Background job started from a Conduit voice conversation. Nobody is watching this chat live, so work on it on your own. When you are done, end your final message with a plain-language summary that can be read aloud: what you found or did, with the key details.]'

describe('cleanUserText', () => {
  it("drops the turn's recalled memory a picture turn stored with the words", () => {
    // Eric's message to Nahida, 2026-11-27: Hermes kept the turn's context after the picture's line.
    const stored =
      'new reference sheet for conduit chan. also did i give you the one for nori chan?\n\n[screenshot]\n<memory-context>\n' +
      '[System note: The following is recalled memory context, NOT new user input.]\n\n- The conduit-chan comics project is live.\n</memory-context>\n\nA plugin note.'
    expect(cleanUserText(stored).text).toBe('new reference sheet for conduit chan. also did i give you the one for nori chan?')
    expect(cleanUserText('Before\n<memory-context>\nrecalled, cut off').text).toBe('Before')
    expect(cleanUserText('[screenshot] is what Hermes writes').text).toBe('[screenshot] is what Hermes writes')
    // A picture sent with no words still draws its turn.
    expect(cleanUserText('[screenshot]\n<memory-context>\nrecalled\n</memory-context>').text).toBe('[screenshot]')
  })

  it("previews a chat's last row without a compaction's summary", () => {
    const prior = '[PRIOR CONTEXT \u2014 for reference only; not a new message]'
    const delimiter = '[END OF PRIOR CONTEXT \u2014 COMPACTION SUMMARY BELOW]'
    expect(previewText(`${prior}\nWiring all three now.\n\n${delimiter}\n\n[CONTEXT COMPACTION] Earlier.`)).toBe('Wiring all three now.')
    expect(previewText(`${prior}\nWiring all three now. And then`)).toBe('Wiring all three now. And then')
    expect(previewText('[CONTEXT COMPACTION \u2014 REFERENCE ONLY] Earlier turns were compacted.')).toBe('')
    expect(previewText('new sheet\n\n[screenshot]\n<memory-context>\nrecalled')).toBe('new sheet')
  })

  it('keeps a picture Hermes 0.23 noted below the attached context', () => {
    const raw =
      '@file:attachments/note.txt\n\nWhat colour is the square?\n\n--- Attached Context ---\n\n📄 @file:attachments/note.txt (16 tokens)\n```\nThe secret word is pineapple. @image:/not/this.png\n```\n\n[Image attached at: /root/.hermes/images/upload_npp8jbz1.png]\n[screenshot]\n[Current Time: Wednesday]'
    expect(cleanUserText(raw)).toEqual({
      text: 'What colour is the square?',
      attachments: [
        { kind: 'file', value: 'attachments/note.txt' },
        { kind: 'image', value: '/root/.hermes/images/upload_npp8jbz1.png' }
      ]
    })
  })

  it('takes off the voice background-job brief', () => {
    expect(cleanUserText(`${VOICE_BRIEF}\n\nFind me a flight to Tokyo`)).toEqual({ text: 'Find me a flight to Tokyo', attachments: [] })
  })

  it('splits leading @file: lines into attachments, in every quoting', () => {
    const raw = '@file:`/home/me/My Docs/report.pdf`\n@file:"/tmp/a b.png"\n@file:/tmp/c.txt\n\nSummarize these'
    expect(cleanUserText(raw)).toEqual({
      text: 'Summarize these',
      attachments: [
        { kind: 'file', value: '/home/me/My Docs/report.pdf' },
        { kind: 'file', value: '/tmp/a b.png' },
        { kind: 'file', value: '/tmp/c.txt' }
      ]
    })
  })

  it('cuts the attached context Hermes stores after a reference', () => {
    const raw = '@url:https://example.com\nWhat does this say?\n\n--- Attached Context ---\n\n# Example Domain\nlots of page text'
    expect(cleanUserText(raw)).toEqual({ text: 'What does this say?', attachments: [{ kind: 'url', value: 'https://example.com' }] })
  })

  it('leaves a footer-looking line alone when the message names no reference', () => {
    const raw = 'Please keep this:\n--- Attached Context ---\nas is'
    expect(cleanUserText(raw).text).toBe(raw)
  })

  it('keeps an @ mid-message as words', () => {
    expect(cleanUserText('email me at a@b.com').text).toBe('email me at a@b.com')
  })
})

describe('previewText', () => {
  it('drops a voice brief cut off before its closing bracket', () => {
    expect(previewText(VOICE_BRIEF.slice(0, 80))).toBe('')
  })

  it('falls back to the first attachment’s name', () => {
    expect(previewText('@file:/Users/me/Desktop/notes.md')).toBe('notes.md')
  })

  it('folds lines', () => {
    expect(previewText('one\ntwo\n\nthree')).toBe('one two three')
  })
})

describe('user messages in the transcript', () => {
  it('cleans stored rows', () => {
    const items = fromHistory([{ role: 'user', text: `${VOICE_BRIEF}\n\n@file:/tmp/x.pdf\nRead it`, row_id: 1 }])
    expect(items).toEqual([{ kind: 'user', key: 'row-1', text: 'Read it', at: undefined, attachments: [{ kind: 'file', value: '/tmp/x.pdf' }] }])
  })

  it('cleans a message sent from the phone', () => {
    const state = applyEvent(emptyTranscript, { type: 'user.message', payload: { text: '@file:/tmp/y.png' } })
    expect(state.items[0]).toMatchObject({ kind: 'user', text: '', attachments: [{ kind: 'file', value: '/tmp/y.png' }] })
  })
})

describe('folded previews', () => {
  it('takes references off a preview the dashboard put on one line', () => {
    expect(previewText('@file:/tmp/notes/plan.md @url:https://x.dev Send the media please')).toBe('Send the media please')
    expect(previewText('@file:/tmp/notes/plan.md Send it --- Context Warnings --- ⚠️ @file:/tmp/notes/plan.md: not found')).toBe('Send it')
  })

  it('shows a pending message cleaned', async () => {
    const { addPendingUser } = await import('../src/renderer/src/state/transcript')
    const state = addPendingUser(emptyTranscript, '@file:/tmp/a.md\nhello')
    expect(state.items[0]).toMatchObject({ text: 'hello', pending: true, attachments: [{ kind: 'file', value: '/tmp/a.md' }] })
  })
})

describe('the second Asuka round', () => {
  it('reads a reference mid-sentence as its value', () => {
    expect(cleanUserText('can we update the plugin with main + @url:`https://github.com/a/b/pull/1`?').text).toBe(
      'can we update the plugin with main + https://github.com/a/b/pull/1?'
    )
    expect(previewText('how can we adapt this skill? @url:`https://github.com/Leonxl/skills/tree/main/x')).toBe(
      'how can we adapt this skill? github.com/Leonxl/skills/tree/main/x'
    )
  })

  it('leaves no footer stub in a preview cut inside the marker', () => {
    expect(previewText('@url:`https://example.com/a` --- Attached Co')).toBe('example.com/a')
    expect(previewText('Relay update @url:`https://x.dev/y` --- Attached Context --- lots')).toBe('Relay update x.dev/y')
  })

  it('takes a reference cut off inside its quotes as the whole preview', () => {
    expect(previewText('@url:`https://github.com/kaishi00/hermes-conduit-notifier/pull/86')).toBe('github.com/kaishi00/hermes-conduit-notifier/pull/86')
  })

  it('cuts the recent voice conversation a delegation appends', () => {
    const raw =
      'Where am I\n\n[Recent voice conversation, for context only. Do just the request above: earlier requests marked "handled separately" were passed on before.]\nAssistant: Hi\nUser: Where am I'
    expect(cleanUserText(raw).text).toBe('Where am I')
    expect(previewText(raw.replace(/\n+/g, ' ').slice(0, 60))).toBe('Where am I')
  })
})

describe('cleanTitle', () => {
  it('cuts a voice delegation’s conversation from a title', async () => {
    const { cleanTitle } = await import('../src/renderer/src/state/text')
    expect(cleanTitle('Where am I [Recent voice conv')).toBe('Where am I')
    expect(cleanTitle('Relay/Plugin Update')).toBe('Relay/Plugin Update')
    expect(cleanTitle("What's the weather today in Virginia Beach [Recent voice…")).toBe("What's the weather today in Virginia Beach")
    expect(cleanTitle('@url:`https://www.reddit.com/r/vibecoding/commen…')).toBe('reddit.com/r/vibecoding/commen…')
    expect(cleanTitle('@file:`.hermes/attachments/Pasted content (3.0…')).toBe('Pasted content (3.0…')
  })
})

describe('a preview cut just past a long link', () => {
  it('shows the link instead of the letter after it', () => {
    expect(previewText('@url:`https://github.com/kaishi00/hermes-conduit-notifier/pull/86` g…')).toBe('github.com/kaishi00/hermes-conduit-notifier/pull/86')
    expect(previewText('ok')).toBe('ok')
  })
})

describe('a message’s pictures', () => {
  it('come out of the words wherever they stand', () => {
    expect(cleanUserText('Look at this\n@image:/home/h/images/upload_t1.png')).toEqual({
      text: 'Look at this',
      attachments: [{ kind: 'image', value: '/home/h/images/upload_t1.png' }]
    })
    expect(cleanUserText('@file:/up/a.pdf\n\nboth @image:`/x/my pic.png` please')).toEqual({
      text: 'both please',
      attachments: [
        { kind: 'file', value: '/up/a.pdf' },
        { kind: 'image', value: '/x/my pic.png' }
      ]
    })
    expect(cleanUserText('[Image attached at: /tmp/a.jpg]\nhi').attachments).toEqual([{ kind: 'image', value: '/tmp/a.jpg' }])
    expect(
      cleanUserText('[The user attached an image:\nA cat on a mat.]\n[You can examine it with vision_analyze using image_url: /c/cat.png]\n\nWhat breed?')
    ).toEqual({ text: 'What breed?', attachments: [{ kind: 'image', value: '/c/cat.png' }] })
  })
})

describe('a list preview with a picture', () => {
  it('shows the words without the picture’s path', () => {
    expect(previewText('Look at this @image:/tmp/claude-0/-home-user/23727ba9-0ca2-5...')).toBe('Look at this')
    expect(previewText('@image:/h/images/upload_t1.png')).toBe('upload_t1.png')
  })
})
