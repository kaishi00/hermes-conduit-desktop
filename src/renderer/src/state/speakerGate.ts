// A live call's microphone on the computer's speakers, as the phone holds it
// (GeminiLiveConversationController.isMicrophoneGatedForSpeaker): closed from
// the reply's first sound until the reply has ended and played out, plus a
// short tail. Open between a reply's sentences, the microphone hears the
// sentence just played and the room, the server takes that for the user
// cutting in, and it drops the rest of the reply (hermes-conduit issue 3159).

/** The microphone stays closed this long after the reply's audio ends, so its tail isn't heard back. */
export const ECHO_TAIL_MS = 300
/** A latency the computer reports is believed up to this. */
const MAX_DELAY = 1

type Output = { currentTime: number; outputLatency?: number; baseLatency?: number }

/**
 * Seconds between a sample's scheduled time and the microphone's copy of it reaching the call:
 * the output's own latency (a Bluetooth speaker or a television adds a few hundred milliseconds),
 * the microphone's, and the buffer its samples wait in.
 */
export function echoDelay(output: Output, micLatency: unknown, bufferSeconds: number): number {
  const part = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  return Math.min(MAX_DELAY, part(output.outputLatency) + part(output.baseLatency) + part(micLatency) + part(bufferSeconds))
}

/** The latency the microphone's track reports, where it reports one. */
export const micLatency = (stream: MediaStream): unknown => (stream.getAudioTracks()[0]?.getSettings() as { latency?: unknown } | undefined)?.latency

export class SpeakerGate {
  /** The reply is still arriving: more of it may follow what has played. */
  private arriving = false
  /** Interrupt was pressed while the reply was arriving: the rest of that reply isn't played. */
  private dropping = false

  /** The reply is still arriving, whatever plays. */
  get replying(): boolean {
    return this.arriving
  }

  /** Interrupt dropped the reply that is arriving: its words aren't shown either. */
  get dropped(): boolean {
    return this.dropping
  }

  /**
   * Audio of the reply came: whether it plays. `open` is false where the server names its responses and
   * none is open: audio that trails a response's end plays, and no end will follow it to open the microphone.
   */
  audio(open = true): boolean {
    if (this.dropping) return false
    if (open) this.arriving = true
    return true
  }

  /** Words of the reply came: whether they show. */
  words(open = true): boolean {
    return this.audio(open)
  }

  /** A reply starts: one Interrupt dropped ended, even if the server never said so. */
  replyStarted(): void {
    this.dropping = false
  }

  /** The reply ended, the server heard the user cut in, or the connection is gone. */
  replyEnded(): void {
    this.arriving = false
    this.dropping = false
  }

  /**
   * The Interrupt button. Only a reply still arriving is dropped: pressed after it ended, while
   * its last audio plays, the next reply is heard (the phone's ruling, hermes-conduit issue 1790).
   */
  interrupt(): void {
    this.dropping = this.arriving
    this.arriving = false
  }

  /** Whether the microphone's samples are held back now. */
  holds(output: Output | null, playUntil: number, delay: number): boolean {
    if (this.arriving) return true
    return !!output && output.currentTime < playUntil + delay + ECHO_TAIL_MS / 1000
  }
}
