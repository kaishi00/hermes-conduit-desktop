// What a Local Live call saves of one spoken reply, whatever order the server ends it in.
// A reply the user cut (Interrupt, or the server hearing them over it) is saved as the words
// that were shown, not the server's whole transcript, and never twice.

export class ReplyRecord {
  /** The words shown of the reply now arriving. */
  private heard = ''
  /** The reply was cut: its saved turn is what was heard. */
  private cut = false
  /** The reply ended before its transcript did, and what was heard is saved: a transcript that follows is the same reply's. */
  private saved = false

  private reset(): void {
    this.heard = ''
    this.cut = false
    this.saved = false
  }

  /** A response starts. Returns what was heard of a reply that never ended, to save. */
  started(): string {
    const left = this.heard
    this.reset()
    return left
  }

  /** Words of the reply were shown. */
  words(text: string): void {
    if (this.saved) this.reset()
    this.heard += text
  }

  /** The reply was cut: Interrupt, the server heard the user, or it cancelled or cleared the response. */
  cancelled(): void {
    this.cut = true
  }

  /**
   * The response ended, the connection dropped or the call is over. Returns what was heard of a reply
   * whose transcript hasn't ended, to save; '' when its turn is saved already or nothing was shown.
   */
  ended(): string {
    if (!this.heard) return ''
    const heard = this.heard
    this.heard = ''
    this.saved = true
    return heard
  }

  /**
   * The reply's whole transcript came. Returns the turn to save and whether the line shows the whole
   * text; null when this reply's turn was saved at its end, so the line stays as it is.
   */
  transcript(whole: string): { keep: string; whole: boolean } | null {
    if (this.saved) {
      this.reset()
      return null
    }
    const result = this.cut ? { keep: this.heard, whole: false } : { keep: whole, whole: true }
    this.reset()
    return result
  }
}
