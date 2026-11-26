/**
 * The user's own words, sent with the request a live voice model wrote for
 * Hermes, as on the phone (`VoiceRequestWords`, hermes-conduit issue 3236;
 * Eric, 2026-11-25). A model that calls a tool writes the request itself, and
 * can turn a remark into steps or a go-ahead nobody said: Hermes gets what the
 * user said since their last request beside it, marked as theirs. GPT-Live's
 * delegations go to the chat in the user's own words already. Not UI copy.
 */

/** Starts the user's words, after the model's request: the phone's `VoiceRequestWords.marker`, word for word. */
export const REQUEST_WORDS_MARKER =
  "\n\n[The user's own words on the call since their last request, as transcribed. The request above is the voice model's wording of them: where it adds steps, details or a go-ahead the user didn't say, go by the user's words.]\n"

/** The most of what the user said that goes with one request: the newest of it. */
export const REQUEST_WORDS_MAX = 1000
/** What leads the user's answer to "send this?" when it goes with the request (askFirst's `adding`). */
export const ASKED_ANSWER_LEAD = '\n\nWhen asked whether to send this, the user said: "'

/** How long a request waits for the user's words: their transcript can trail the model's call. */
export const REQUEST_WORDS_WAIT_MS = 1200

const comparable = (text: string): string =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .join(' ')

/**
 * `request` with what the user `said` since their last one under the marker,
 * a line for each thing they said. The request alone when they said nothing,
 * when it already carries their words, or when it is their words (a model
 * that passed them on as they were).
 */
/** A script written without spaces has no word boundaries to pad; compare it as a phrase. */
const containsWords = (haystack: string, words: string): boolean => {
  if (!words) return true
  if (!words.includes(' ') && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words)) return haystack.includes(words)
  return ` ${haystack} `.includes(` ${words} `)
}

export function withUserWords(said: string[], request: string): string {
  if (request.includes(REQUEST_WORDS_MARKER)) return request
  const lines: string[] = []
  let count = 0
  for (const line of [...said].reverse()) {
    const words = line.split(/\s*[\r\n]+\s*/).join(' ').trim()
    if (!words) continue
    if (count + words.length > REQUEST_WORDS_MAX) {
      // The newest thing alone is too long: its end is what the request followed.
      if (!lines.length) lines.push('…' + words.slice(-REQUEST_WORDS_MAX))
      break
    }
    lines.unshift(words)
    count += words.length
  }
  if (!lines.length) return request
  const theirs = comparable(lines.join(' '))
  if (!theirs || containsWords(comparable(request), theirs)) return request
  return request + REQUEST_WORDS_MARKER + lines.join('\n')
}

/** The request as the model wrote it, without the user's words: a job's title reads only this. */
export function modelWords(request: string): string {
  const ends = [request.indexOf(REQUEST_WORDS_MARKER), request.indexOf(ASKED_ANSWER_LEAD)].filter(at => at >= 0)
  return ends.length ? request.slice(0, Math.min(...ends)) : request
}

/** What the user said in a call that no request carried yet, fed from its transcript. */
export class RequestWords {
  /** Finished lines no request took. */
  private done: string[] = []
  /** The line being said, how much of it a request took, and whether more of it may come. */
  private line = ''
  private taken = 0
  private open = false
  /** Where the answer just read ended: lines before it were that request's, later ones are not. */
  private boundary = 0
  private markedLine = ''

  constructor(private readonly now: () => number = Date.now) {}

  /** The user's words as they're transcribed: a piece at a time, or (`whole`) the line so far. */
  heard(text: string, whole = false): void {
    if (whole) {
      // The same line grown, or another one: a line that doesn't continue the last is new.
      // A line still growing when the model spoke goes on as the same line.
      const grown = this.line !== '' && text.startsWith(this.line) && (this.open || text.length > this.line.length)
      // Whole mode can rewrite the line the answer came from ("Yes" -> "Yes and a cab")
      // after the model spoke. What was already read as the answer is consumed, not new words.
      const consumed = !this.open && this.markedLine && text.startsWith(this.markedLine) ? this.markedLine.length : null
      if (consumed !== null) this.markedLine = ''
      if (!grown && !(this.open && this.line.startsWith(text))) this.close()
      this.line = text
      this.taken = consumed !== null ? Math.min(consumed, text.length) : Math.min(this.taken, text.length)
    } else {
      if (!this.open) this.close()
      this.line += text
    }
    this.open = true
  }

  /** The answer being read ends here; later finished lines belong to the next request. */
  mark(): void {
    // A whole-mode line holding the answer closes into `done` later, so count it here.
    this.boundary = this.done.length + (this.line.trim() ? 1 : 0)
    this.markedLine = this.line
  }

  /** The model spoke: the user's next words start a new line. */
  modelSpoke(): void {
    this.open = false
  }

  private close(): void {
    const rest = this.line.slice(this.taken).trim()
    if (rest) this.done.push(rest)
    this.line = ''
    this.taken = 0
  }

  /** What no request took yet, oldest first. */
  pending(): string[] {
    const rest = this.line.slice(this.taken).trim()
    return rest ? [...this.done, rest] : [...this.done]
  }

  /** All of it went with a request, or was the user's answer about one. */
  skip(keepLine = false): void {
    // `keepLine`: only clear up to the answer; later lines are the next request's.
    this.done = keepLine ? this.done.slice(this.boundary) : []
    // The answer boundary belongs to this request only: a later request can start with
    // the same word ("Yes") and must not have its prefix consumed again (issue 529 review).
    this.markedLine = ''
    // A consumed line is over: a later line can start with the same word without
    // inheriting its offset or being mistaken for the same growing line.
    if (!keepLine) {
      this.line = ''
      this.taken = 0
    }
  }

  /**
   * Words a request carried that Hermes didn't take (a refused start): they
   * go with the model's retry, ahead of anything said since (the phone's
   * `requestNotTaken`, hermes-conduit #3337).
   */
  giveBack(said: string[]): void {
    const back = said.map(line => line.trim()).filter(Boolean)
    if (back.length) this.done = [...back, ...this.done]
  }

  /** What the user said for the request being made, given `waitMs` to arrive and to stop growing. */
  async take(waitMs: number): Promise<string[]> {
    const deadline = this.now() + waitMs
    let earlier: string | null = null
    for (;;) {
      const fresh = this.pending()
      const key = fresh.join('\n')
      if (this.now() >= deadline || (fresh.length > 0 && key === earlier)) {
        this.skip()
        return fresh
      }
      earlier = key
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}
