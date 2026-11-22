/**
 * Settings > Voice > "Greet me when a call connects", after the phone's Live
 * call style greeting (hermes-conduit's FEATURE_MAP "A live call's opening"):
 * off, the call stays silent until the user speaks; on, every live mode opens
 * with one turn Conduit sends, once per call, never on a reconnect. Empty is a
 * short greeting in the model's own words. Kept on this computer, so it works
 * with no iPhone.
 */
import { t } from '../../../shared/i18n'

const KEY = 'conduit.liveGreeting'
/** The phone's limit, LiveVoiceStyle.maxGreetingCharacters. */
export const MAX_GREETING_CHARACTERS = 200

/** Null: off. "": a greeting in the model's own words. Text: that greeting. */
export function liveGreeting(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLiveGreeting(greeting: string | null): void {
  try {
    if (greeting === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, cleanedGreeting(greeting))
  } catch {
    // Off next time.
  }
}

/** The greeting on one line, without double quotes (it is quoted to the model), clipped. */
export function cleanedGreeting(text: string): string {
  const one = text.replace(/"/g, "'").split(/\s+/).filter(Boolean).join(' ')
  return Array.from(one).slice(0, MAX_GREETING_CHARACTERS).join('')
}

/**
 * The first turn a live model is sent, as the phone's LiveVoiceGreeting.turn;
 * null when the greeting is off. Written for the model, not UI copy.
 */
export function openingTurn(greeting: string | null = liveGreeting()): string | null {
  if (greeting === null) return null
  const say = greeting ? ` Say: "${cleanedGreeting(greeting)}"` : ''
  return `[The call just connected. Greet the user in one short sentence so they know you're there and listening.${say} Then wait for them.]`
}

/**
 * What Local Live's speech server says as the readiness check's answer, as
 * written (no model writes it); null when the greeting is off.
 */
export function spokenGreeting(greeting: string | null = liveGreeting()): string | null {
  if (greeting === null) return null
  return cleanedGreeting(greeting) || t("Hi, I'm listening.")
}
