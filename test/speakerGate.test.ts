import { describe, expect, it } from 'vitest'
import { ECHO_TAIL_MS, SpeakerGate, echoDelay } from '../src/renderer/src/state/speakerGate'

const TAIL = ECHO_TAIL_MS / 1000
const at = (currentTime: number) => ({ currentTime })

describe("a live call's microphone on the speakers", () => {
  it('stays closed while audio plays and for a tail after it', () => {
    const gate = new SpeakerGate()
    expect(gate.holds(at(1), 0, 0)).toBe(false)
    expect(gate.holds(at(1), 5, 0)).toBe(true)
    expect(gate.holds(at(5 + TAIL - 0.01), 5, 0)).toBe(true)
    expect(gate.holds(at(5 + TAIL + 0.01), 5, 0)).toBe(false)
  })

  it("stays closed between a reply's sentences, until the reply has ended and played out (issue 3159)", () => {
    const gate = new SpeakerGate()
    expect(gate.audio()).toBe(true)
    // The first sentence played out a second ago, and the next hasn't come.
    expect(gate.holds(at(6), 5, 0)).toBe(true)
    expect(gate.replying).toBe(true)
    gate.replyEnded()
    expect(gate.holds(at(6), 5, 0)).toBe(false)
  })

  it("waits out the computer's own latency after the audio's scheduled end", () => {
    const gate = new SpeakerGate()
    const delay = echoDelay({ currentTime: 0, outputLatency: 0.25, baseLatency: 0.01 }, 0.02, 2048 / 24_000)
    expect(delay).toBeCloseTo(0.25 + 0.01 + 0.02 + 2048 / 24_000)
    expect(gate.holds(at(5 + TAIL + 0.2), 5, delay)).toBe(true)
    expect(gate.holds(at(5 + TAIL + delay + 0.01), 5, delay)).toBe(false)
  })

  it('counts only latencies that are real numbers, up to a second', () => {
    expect(echoDelay({ currentTime: 0 }, undefined, 0)).toBe(0)
    expect(echoDelay({ currentTime: 0, outputLatency: NaN, baseLatency: -1 }, 'x', 0.1)).toBeCloseTo(0.1)
    expect(echoDelay({ currentTime: 0, outputLatency: 30 }, 0, 0)).toBe(1)
  })

  it('opens when the server hears the user cut in or the connection drops', () => {
    const gate = new SpeakerGate()
    gate.audio()
    gate.replyEnded()
    expect(gate.replying).toBe(false)
    expect(gate.holds(at(1), 0, 0)).toBe(false)
  })

  it('plays audio that trails a named response without holding the microphone for an end that will not come', () => {
    const gate = new SpeakerGate()
    expect(gate.audio(false)).toBe(true)
    expect(gate.replying).toBe(false)
    expect(gate.words(false)).toBe(true)
    expect(gate.replying).toBe(false)
  })

  it('Interrupt drops the rest of a reply still arriving, and the next reply is heard', () => {
    const gate = new SpeakerGate()
    gate.audio()
    gate.interrupt()
    expect(gate.replying).toBe(false)
    expect(gate.dropped).toBe(true)
    expect(gate.audio()).toBe(false)
    expect(gate.words()).toBe(false)
    expect(gate.holds(at(1), 0, 0)).toBe(false)
    gate.replyEnded()
    expect(gate.dropped).toBe(false)
    expect(gate.audio()).toBe(true)
  })

  it('a new response ends what Interrupt dropped, even if the old one never said it ended', () => {
    const gate = new SpeakerGate()
    gate.audio()
    gate.interrupt()
    gate.replyStarted()
    expect(gate.audio()).toBe(true)
  })

  it('Interrupt after the reply ended, while its tail plays, drops nothing (issue 1790)', () => {
    const gate = new SpeakerGate()
    gate.audio()
    gate.replyEnded()
    gate.interrupt()
    expect(gate.dropped).toBe(false)
    expect(gate.audio()).toBe(true)
  })
})
