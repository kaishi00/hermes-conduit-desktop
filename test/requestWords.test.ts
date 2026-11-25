import { describe, expect, it } from 'vitest'
import { AskFirst, adding } from '../src/renderer/src/state/askFirst'
import { REQUEST_WORDS_MARKER as MARKER, REQUEST_WORDS_MAX, RequestWords, modelWords, withUserWords } from '../src/renderer/src/state/requestWords'
import { jobTitle } from '../src/renderer/src/state/voiceJobs'

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
    expect(await ask.ask('ask_thread', 'Post them from the brand account.')).toEqual({ request: 'Post them from the brand account.' + MARKER + 'Brand only.' })
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
    expect(await ask.release()).toEqual({
      send: true,
      tool: 'start_job',
      request: 'Clean the inbox and archive everything.' + MARKER + 'They can clean the inbox I guess'
    })
    // Their yes was that request's: the next one doesn't carry it.
    ask.set(false)
    expect(await ask.ask('ask_thread', 'Now the drafts.')).toEqual({ request: 'Now the drafts.' })
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
})
