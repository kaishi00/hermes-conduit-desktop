/**
 * The rest of Settings > Voice's Live call style, after the phone's
 * LiveVoiceStyle (hermes-conduit's FEATURE_MAP "A live call's personality and
 * your instructions"): a tone, whether the model backchannels, how much it
 * says, and the user's own instructions, added after Conduit's rules. Kept on
 * this computer, one style for every live mode, so it works with no iPhone.
 * The greeting is in liveGreeting.ts. The model-facing text is the phone's,
 * word for word, and not localized.
 */

export type LiveTone = 'relaxed' | 'neutral' | 'professional'
export type AnswerLength = 'concise' | 'standard' | 'detailed'

export interface LiveStyle {
  /** Null keeps the voice model's own tone and the persona's. */
  tone: LiveTone | null
  backchannels: boolean
  answerLength: AnswerLength
  /** Null or empty adds nothing. */
  extraInstructions: string | null
}

export const TONES: LiveTone[] = ['relaxed', 'neutral', 'professional']
export const ANSWER_LENGTHS: AnswerLength[] = ['concise', 'standard', 'detailed']
/** The phone's LiveVoiceStyle.maxExtraInstructionsCharacters. */
export const MAX_EXTRA_INSTRUCTIONS_CHARACTERS = 2_000

const TONE_KEY = 'conduit.liveTone'
const BACKCHANNELS_KEY = 'conduit.liveBackchannels'
const LENGTH_KEY = 'conduit.liveAnswerLength'
const INSTRUCTIONS_KEY = 'conduit.liveInstructions'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // The default next time.
  }
}

export function liveStyle(): LiveStyle {
  const tone = read(TONE_KEY)
  const length = read(LENGTH_KEY)
  return {
    tone: TONES.includes(tone as LiveTone) ? (tone as LiveTone) : null,
    backchannels: read(BACKCHANNELS_KEY) !== 'false',
    answerLength: ANSWER_LENGTHS.includes(length as AnswerLength) ? (length as AnswerLength) : 'standard',
    extraInstructions: read(INSTRUCTIONS_KEY)
  }
}

export const setLiveTone = (tone: LiveTone | null) => write(TONE_KEY, tone)
export const setLiveBackchannels = (on: boolean) => write(BACKCHANNELS_KEY, on ? null : 'false')
export const setLiveAnswerLength = (length: AnswerLength) => write(LENGTH_KEY, length === 'standard' ? null : length)
export const setLiveInstructions = (text: string) => write(INSTRUCTIONS_KEY, text.trim() ? text.slice(0, MAX_EXTRA_INSTRUCTIONS_CHARACTERS) : null)

/** The user's instructions trimmed and clipped; null when nothing's left. */
export function cleanedInstructions(text: string | null): string | null {
  if (!text) return null
  const trimmed = Array.from(text.trim()).slice(0, MAX_EXTRA_INSTRUCTIONS_CHARACTERS).join('').trim()
  return trimmed || null
}

/**
 * The answer-length rule in the live model's instructions, the phone's
 * LiveVoiceAnswerLength.instructions(readsBack: true): every desktop call
 * reads replies back.
 */
export function answerLengthRule(length: AnswerLength = 'standard'): string {
  const lead =
    length === 'concise'
      ? 'Keep answers short and to the point: lead with the answer itself and the one or two specifics that make it useful (the number, name or step that matters), usually one to three sentences. Leave out background and caveats unless they change the answer; the user will ask if they want more. Still give a real answer, never a vague headline.'
      : length === 'detailed'
        ? "Be thorough. Answer a real question in depth the first time: the answer, then the reasoning behind it, the numbers, names, steps and options that matter, an example where it helps, and the caveats worth knowing, often several paragraphs of speech. Don't leave the user asking follow-up questions to get the full picture, and don't end on an offer to say more instead of saying it."
        : "Say enough to be useful. Answer a real question fully the first time: the answer, then the details that make it useful (the reasons, numbers, names, steps or options that matter, and any caveat), usually several sentences and more when the topic needs it. Don't leave the user asking follow-up questions to get the substance, and don't stop at a headline or end on an offer to say more instead of saying it."
  const speech =
    " This goes for everything you say, Hermes' results included, except a read-back: when the user asks to hear a reply again or in full and Conduit gives it to you to read, read all of it word for word, however long. It is still speech: say it in natural spoken sentences, not lists, headings or Markdown, and never read out URLs. When the detail is on the user's screen, that takes the place of a long spoken answer."
  return length === 'concise' ? lead + speech : lead + speech + ' Keep it short only for greetings, small talk, acknowledgements and confirmations.'
}

/**
 * The style's tone and backchannels, then the user's own instructions: after
 * the persona and the call's own blocks, before the language rule, as on the
 * phone. Empty when nothing is set.
 */
export function styleInstructions(style: LiveStyle = liveStyle()): string {
  const lines: string[] = []
  if (style.tone === 'relaxed') lines.push('Tone: relaxed and warm, at an easy, unhurried pace.')
  else if (style.tone === 'neutral') lines.push('Tone: neutral and matter-of-fact, at a normal conversational pace. Skip filler and pleasantries.')
  else if (style.tone === 'professional') lines.push('Tone: professional, at a brisk pace. No small talk, filler or pleasantries: spend the words on substance.')
  if (!style.backchannels) lines.push('Backchannels: none. Don\'t say "mm-hmm", "right", "I see" or similar while the user talks or before you answer.')
  const voice = lines.length
    ? `\n\n[Voice style the user chose in Conduit. It replaces any tone, pace or backchannel guidance above.]\n${lines.join('\n')}`
    : ''
  const text = cleanedInstructions(style.extraInstructions)
  const own = text
    ? `\n\n[The user's own instructions for you, written in Conduit's settings. Follow them, except where they conflict with the rules above about tools, jobs, approvals, and never saying something was started or done unless a tool said so: those rules always come first.]\n<user_instructions>\n${text.replace(/<\/user_instructions>/gi, '</ user_instructions>')}\n</user_instructions>`
    : ''
  return voice + own
}
