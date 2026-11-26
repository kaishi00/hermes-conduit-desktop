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

/** Letters an unspaced answer needs before it's looked for inside the request's words (the phone's `unspacedMinimum`). */
const UNSPACED_MINIMUM = 3
/** Han, Hiragana and Katakana: scripts written without spaces. Korean is written with spaces, so it takes the whole-word check. */
const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const letter = /[\p{L}\p{M}\p{N}]/u

/**
 * Whether `request` already carries the user's `words` (already `comparable`),
 * as the phone's `VoiceRequestWords.carries` decides it: as whole words, or,
 * for Chinese and Japanese, as their letters and numbers in it with
 * punctuation left out, starting or ending where one of the request's runs
 * between punctuation does, so "没问题" inside "这没问题的事" isn't the
 * user's answer (hermes-conduit issue 3279). A short answer ("不", "好的")
 * sits inside too many longer words, so under three letters it must stand as
 * a run of its own.
 */
export function carries(request: string, words: string): boolean {
  if (!words) return true
  if (unspaced.test(words)) {
    const theirs = [...words].filter(ch => letter.test(ch)).join('')
    if ([...theirs].length >= UNSPACED_MINIMUM) {
      let letters = ''
      const edges = new Set<number>([0])
      for (const ch of request.toLowerCase()) {
        if (letter.test(ch)) letters += ch
        else edges.add(letters.length)
      }
      edges.add(letters.length)
      for (let start = letters.indexOf(theirs); start >= 0; start = letters.indexOf(theirs, start + 1)) {
        if (edges.has(start) || edges.has(start + theirs.length)) return true
      }
      return false
    }
  }
  return ` ${comparable(request)} `.includes(` ${words} `)
}

/**
 * `request` with what the user `said` since their last one under the marker,
 * a line for each thing they said. The request alone when they said nothing,
 * when it already carries their words, or when it is their words (a model
 * that passed them on as they were).
 */
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
  if (!theirs || carries(request, theirs)) return request
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
    // The boundary was this answer's too: a take() between mark() and skip(true)
    // must not leave it to cut the next request's lines (desktop#529).
    this.boundary = 0
    // A consumed line is over: a later line can start with the same word without
    // inheriting its offset or being mistaken for the same growing line.
    if (!keepLine) {
      this.line = ''
      this.taken = 0
    }
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
