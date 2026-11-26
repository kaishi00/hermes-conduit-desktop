import { describe, expect, it } from 'vitest'
import { AskFirst, adding } from '../src/renderer/src/state/askFirst'
import { REQUEST_WORDS_MARKER as MARKER, REQUEST_WORDS_MAX, RequestWords, modelWords, withUserWords } from '../src/renderer/src/state/requestWords'
import { jobTitle } from '../src/renderer/src/state/voiceJobs'

describe('leftovers of #525 and #528 (issue 529)', () => {
  it('keeps both lines after two model-speech transitions in one settle window', () => {
    const words = new RequestWords(() => 0)
    words.heard('Yes', true)
    words.mark()
    words.modelSpoke()
    words.heard('and order a cab', true)
    words.modelSpoke()
    words.heard(' for eight')
    // The yes and what followed it before the answer was read were the last request's;
    // both later lines are the next request's.
    words.skip(true)
    expect(words.pending()).toEqual(['and order a cab', 'for eight'])
  })

  it('strips a yes already read from a whole line rewritten after the model spoke', () => {
    const words = new RequestWords(() => 0)
    words.heard('Yes', true)
    words.mark()
    words.modelSpoke()
    words.heard('Yes and a cab', true)
    expect(words.pending()).toEqual(['and a cab'])
  })

  it('does not eat the start of a later request that repeats the earlier answer', () => {
    const words = new RequestWords(() => 0)
    words.heard('Yes', true)
    words.mark()
    // The answer is read without a whole-line rewrite firing the consumed branch.
    words.skip()
    words.modelSpoke()
    words.heard('Yes please', true)
    expect(words.pending()).toEqual(['Yes please'])
  })

  it('compares unspaced scripts without adding the marker for words the request already carries', () => {
    expect(withUserWords(['好的帮我'], '好的帮我订车')).toBe('好的帮我订车')
    expect(withUserWords(['是的'], '好的，帮我订车')).toBe('好的，帮我订车' + MARKER + '是的')
  })

  it('reads Chinese and Japanese past punctuation, at the edge of a run (desktop#529, hermes-conduit issue 3279)', () => {
    // Punctuation on either side doesn't hide words the request carries.
    expect(withUserWords(['好的，帮我'], '好的，帮我订车')).toBe('好的，帮我订车')
    expect(withUserWords(['お願い、タクシー'], 'お願いタクシーを呼んで')).toBe('お願いタクシーを呼んで')
    // A short answer turns up inside longer words: it has to stand on its own.
    expect(withUserWords(['不'], '帮我订车，不要订贵的')).toBe('帮我订车，不要订贵的' + MARKER + '不')
    expect(withUserWords(['好的'], '好的，帮我订车')).toBe('好的，帮我订车')
    // Three letters or more inside a run, touching neither edge, aren't the user's answer.
    expect(withUserWords(['没问题'], '这没问题的事不要做')).toBe('这没问题的事不要做' + MARKER + '没问题')
    expect(withUserWords(['没问题'], '没问题，帮我订车')).toBe('没问题，帮我订车')
    // Korean is written with spaces: whole words.
    expect(withUserWords(['네'], '네 택시 불러줘')).toBe('네 택시 불러줘')
    expect(withUserWords(['네'], '네비 켜줘')).toBe('네비 켜줘' + MARKER + '네')
  })

  it("keeps the next request's lines when a take lands between mark and skip(true) (desktop#529)", () => {
    const words = new RequestWords(() => 0)
    words.heard('one')
    words.modelSpoke()
    words.heard('Yes')
    words.mark()
    // A tool call's own take() clears what was pending, boundary included.
    words.skip()
    words.modelSpoke()
    words.heard('order a cab')
    words.modelSpoke()
    words.heard('for eight')
    words.modelSpoke()
    words.heard('please')
    words.skip(true)
    expect(words.pending()).toEqual(['order a cab', 'for eight', 'please'])
  })
})

describe("the user's own words with a live call's request (hermes-conduit issue 3236)", () => {
  it('adds them under the marker only when they add something', () => {
    expect(withUserWords([' Brand only. ', ''], 'Post them.')).toBe('Post them.' + MARKER + 'Brand only.')
    expect(withUserWords([], 'Post them.')).toBe('Post them.')
    // Passed on as they said it: nothing to add.
    expect(withUserWords(['Check the server, please'], 'check the server please')).toBe('check the server please')
    expect(withUserWords(['check the server'], 'The user said: check the server.')).toBe('The user said: check the server.')
    const carried = 'Post them.' + MARKER + 'Brand only.'
    expect(withUserWords(['Brand only.'], carried)).toBe(carried)
    expect(modelWords(carried)).toBe('Post them.')
    expect(jobTitle(modelWords(carried))).toBe('Post them.')
  })

  it('keeps the newest of a long stretch', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Thing number ${i + 1} I said on the call just now.`)
    const kept = withUserWords(long, 'Do it.')
    expect(kept.endsWith(long[39]!)).toBe(true)
    expect(kept).not.toContain(long[0]!)
    expect(kept.length).toBeLessThanOrEqual('Do it.'.length + MARKER.length + REQUEST_WORDS_MAX + 40)
    expect(withUserWords(['x'.repeat(REQUEST_WORDS_MAX + 50)], 'Do it.')).toBe('Do it.' + MARKER + '…' + 'x'.repeat(REQUEST_WORDS_MAX))
  })

  it('hands each request only what was said since the last one', async () => {
    const words = new RequestWords(() => 0)
    words.heard('I trust what ')
    words.heard("it's going to say")
    expect(await words.take(0)).toEqual(["I trust what it's going to say"])
    // The rest of a line that grew, then a new line after the model spoke.
    words.heard(' they need a truck')
    words.modelSpoke()
    words.heard('Brand only.')
    expect(await words.take(0)).toEqual(['they need a truck', 'Brand only.'])
    expect(await words.take(0)).toEqual([])
    // Whole lines (Grok, Local Live): the same line grown is one line, another is new.
    words.heard('Post', true)
    words.heard('Post the ad', true)
    words.heard('And the flyer', true)
    expect(await words.take(0)).toEqual(['Post the ad', 'And the flyer'])
  })

  it('goes with a request sent now, a held one once OKed, and a correction', async () => {
    let t = 1_000_000
    const ask = new AskFirst(false, () => t, 0, 0)
    ask.heard('Brand only.')
    expect(await ask.ask('ask_thread', 'Post them from the brand account.')).toMatchObject({ request: 'Post them from the brand account.' + MARKER + 'Brand only.' })
    ask.modelSpoke()
    ask.heard('Hold that for a minute')
    expect(await ask.withWords('Pause the job.')).toBe('Pause the job.' + MARKER + 'Hold that for a minute')

    ask.set(true)
    ask.modelSpoke()
    ask.heard('They can clean the inbox I guess')
    const held = await ask.ask('start_job', 'Clean the inbox and archive everything.')
    expect('held' in held && held.held.status).toBe('waiting_for_ok')
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes')
    expect(await ask.release()).toMatchObject({
      send: true,
      tool: 'start_job',
      request: 'Clean the inbox and archive everything.' + MARKER + 'They can clean the inbox I guess'
    })
    // Their yes was that request's: the next one doesn't carry it.
    ask.set(false)
    expect(await ask.ask('ask_thread', 'Now the drafts.')).toMatchObject({ request: 'Now the drafts.' })
  })

  it("titles a job without the user's answer to send this?", () => {
    const request = withUserWords(['Clean it up'], adding('Yes, make it all of it', 'Clean the inbox.'))
    expect(request).toContain('the user said: "Yes, make it all of it"')
    expect(modelWords(request)).toBe('Clean the inbox.')
  })

  it('keeps a line that grows after the model spoke as one line', () => {
    const words = new RequestWords()
    words.heard('Post the', true)
    words.modelSpoke()
    words.heard('Post the ad', true)
    expect(words.pending()).toEqual(['Post the ad'])
    words.modelSpoke()
    words.heard('And the flyer', true)
    expect(words.pending()).toEqual(['Post the ad', 'And the flyer'])
  })

  it("leaves a no about a waiting request out of the next request's words", async () => {
    let t = 1_000_000
    const ask = new AskFirst(true, () => t, 0, 0)
    // Told no through send_request.
    ask.heard('Clean the inbox')
    await ask.ask('start_job', 'Clean the inbox.')
    ask.modelSpoke()
    t += 3000
    ask.heard('No')
    expect((await ask.release()).send).toBe(false)
    ask.set(false)
    ask.modelSpoke()
    ask.heard('Do the drafts')
    expect(await ask.ask('ask_thread', 'Do the drafts.')).toMatchObject({ request: 'Do the drafts.' })
    // Let go by the model without send_request: the bare no stays behind, a change goes along.
    ask.set(true)
    ask.modelSpoke()
    ask.heard('Clean the inbox')
    await ask.ask('start_job', 'Clean the inbox.')
    ask.modelSpoke()
    t += 3000
    ask.heard('No')
    ask.modelSpoke()
    ask.heard('Only the newsletters this time')
    const next = await ask.ask('start_job', 'Archive the newsletters.')
    expect('held' in next).toBe(true)
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes')
    expect(await ask.release()).toMatchObject({ send: true, request: 'Archive the newsletters.' + MARKER + 'Only the newsletters this time' })
  })

  it('reads a yes that arrives in pieces whole', async () => {
    let t = 1_000_000
    const ask = new AskFirst(true, () => t, 0, 600)
    ask.heard('Book a table')
    await ask.ask('ask_thread', 'Book a table for two.')
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes')
    setTimeout(() => ask.heard(' make it for four'), 100)
    const sent = await ask.release()
    expect(sent).toMatchObject({ send: true })
    expect('request' in sent && sent.request).toContain('the user said: "Yes make it for four"')
    ask.set(false)
    ask.modelSpoke()
    ask.heard('And a cab')
    expect(await ask.ask('ask_thread', 'Order a cab.')).toMatchObject({ request: 'Order a cab.' + MARKER + 'And a cab' })
  })

  it('keeps a yes when the model speaks before the rest of the answer arrives', async () => {
    let t = 1_000_000
    const ask = new AskFirst(true, () => t, 0, 600)
    ask.heard('Book a table')
    await ask.ask('ask_thread', 'Book a table for two.')
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes')
    setTimeout(() => {
      ask.modelSpoke()
      ask.heard('and order a cab for eight')
    }, 100)
    expect(await ask.release()).toMatchObject({ send: true, tool: 'ask_thread', request: 'Book a table for two.' })
    // Their next line is the next request's.
    ask.set(false)
    expect(await ask.ask('ask_thread', 'Order a cab.')).toMatchObject({ request: 'Order a cab.' + MARKER + 'and order a cab for eight' })
  })

  it('reads the rest of a yes that arrives after the model already spoke before the answer was read', async () => {
    let t = 1_000_000
    const ask = new AskFirst(true, () => t, 0, 600)
    ask.heard('Book a table')
    await ask.ask('ask_thread', 'Book a table for two.')
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes', true)
    setTimeout(() => ask.heard('Yes make it for four', true), 100)
    const sent = await ask.release()
    expect('request' in sent && sent.request).toContain('the user said: "Yes make it for four"')
  })

  it('takes the same line said again after the model spoke as a new one', async () => {
    const words = new RequestWords()
    words.heard('Do it', true)
    expect(await words.take(0)).toEqual(['Do it'])
    words.modelSpoke()
    words.heard('Do it', true)
    expect(words.pending()).toEqual(['Do it'])
  })

  it('reads a yes taken back in the same breath as a no', async () => {
    let t = 1_000_000
    const ask = new AskFirst(true, () => t, 0, 600)
    ask.heard('Book a table', true)
    await ask.ask('ask_thread', 'Book a table for two.')
    ask.modelSpoke()
    t += 3000
    ask.heard('Yes', true)
    setTimeout(() => ask.heard('actually no', true), 100)
    expect((await ask.release()).send).toBe(false)
  })
})

describe('a request Hermes refused (hermes-conduit #3337)', () => {
  it("gives the user's words back for the retry, and keeps them sent when the outcome is unknown", async () => {
    const ask = new AskFirst(false, () => 1_000_000, 0, 0)
    ask.heard('Book a table for four')
    const first = await ask.ask('start_job', 'Book a table.')
    expect('said' in first && first.said).toEqual(['Book a table for four'])
    if (!('said' in first)) return
    // Refused (too many jobs, a busy session): the retry carries them again, ahead of later words.
    const refused = { status: 'error', error: 'Three background jobs are already running.' }
    expect(ask.settle(first.said, refused)).toBe(refused)
    ask.modelSpoke()
    ask.heard('At eight')
    const retry = await ask.ask('start_job', 'Book a table.')
    expect(retry).toMatchObject({ request: 'Book a table.' + MARKER + 'Book a table for four\nAt eight' })
    if (!('said' in retry)) return
    // No answer back: Hermes may have it, so nothing comes back.
    ask.settle(retry.said, { status: 'error', error: 'timed out', delivery: 'unknown' })
    expect(await ask.ask('start_job', 'Book a table.')).toMatchObject({ request: 'Book a table.' })
    // Started: nothing comes back either.
    ask.heard('Thanks')
    const started = await ask.ask('start_job', 'Book it.')
    if ('said' in started) ask.settle(started.said, { status: 'started', job_id: 'job-1' })
    expect(await ask.ask('start_job', 'Book it.')).toMatchObject({ request: 'Book it.' })
  })

  it('puts given-back words ahead of any said since', () => {
    const words = new RequestWords(() => 0)
    words.heard('Newer')
    words.giveBack(['Older', '  '])
    expect(words.pending()).toEqual(['Older', 'Newer'])
  })
})
