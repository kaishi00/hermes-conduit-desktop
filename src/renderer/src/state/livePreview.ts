/**
 * Settings > Voice > Live call style > "What Conduit sends", after the phone's
 * liveVoiceInstructionsPreview: the instructions the next call in the chosen
 * live mode would get, built by the same code the call uses, with
 * placeholders for what is read from the host when a call starts (memory,
 * personality, the chat and its waiting questions), and the greeting turn.
 * What the host decides (its web search, memory recall, Local Live's fast
 * model) comes in as `host`, read as a call reads it.
 */
import { language, t } from '../../../shared/i18n'
import { briefing, sendsMemory, sendsPersona, voiceModeTitle, type VoiceMode } from './gptLive'
import { geminiSendsMemory, geminiSendsPersona, instructions as geminiInstructions, resolvedSearch, searchMode } from './geminiLive'
import { qwenSendsMemory, qwenSendsPersona } from './qwenLive'
import { grokSendsMemory, grokSendsPersona, instructions as grokInstructions } from './grokLive'
import { AGENT_INSTRUCTIONS, AGENT_LOOKUPS, localLiveAgent, localLivePersona } from './localLive'
import { clockInstructions, liveInstructions } from './liveCall'
import { openingTurn, spokenGreeting } from './liveGreeting'

/** What a call reads from the host as it starts. */
export interface PreviewHost {
  /** The host has a web search (the Gemini and Qwen calls' Automatic search uses it). */
  hostSearch?: boolean
  /** The host's memory provider can be searched (recall_memory). */
  recall?: boolean
  /** Local Live's fast model is there; without it Hermes answers each turn. */
  fastModel?: boolean
}

export interface LivePreview {
  /** The mode's name, as the call screen titles it. */
  mode: string
  instructions: string
  /** The call's first turn, when the greeting is on; Local Live's is the greeting its speech server says. */
  openingTurn: string | null
  /** Local Live's fast model gets these as all its instructions. */
  isLocalLive: boolean
}

/** What the next call in `mode` would be told; null for Classic, and for Local Live with Hermes answering each turn. */
export function livePreview(mode: VoiceMode, host: PreviewHost = {}, now = new Date()): LivePreview | null {
  const memory = t('(What your Hermes agent remembers about you, read when the call starts.)')
  const persona = t("(This profile's SOUL.md, read when the call starts.)")
  const lang = language()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const preview = (text: string, isLocalLive = false): LivePreview => ({
    mode: voiceModeTitle(mode),
    instructions: text,
    openingTurn: isLocalLive ? spokenGreeting() : openingTurn(),
    isLocalLive
  })
  switch (mode) {
    case 'gpt':
      return preview(briefing(lang, sendsPersona() ? persona : '', sendsMemory() ? memory : ''))
    case 'gemini':
    case 'qwen': {
      const qwen = mode === 'qwen'
      const sendsMemory = qwen ? qwenSendsMemory() : geminiSendsMemory()
      return preview(
        geminiInstructions({
          language: lang,
          persona: (qwen ? qwenSendsPersona() : geminiSendsPersona()) ? persona : '',
          memory: sendsMemory ? memory : '',
          recall: sendsMemory && !!host.recall,
          search: resolvedSearch(searchMode(mode), !!host.hostSearch, mode)
        })
      )
    }
    case 'grok':
      return preview(
        grokInstructions({
          language: lang,
          persona: grokSendsPersona() ? persona : '',
          memory: grokSendsMemory() ? memory : '',
          recall: grokSendsMemory() && !!host.recall,
          now,
          timeZone
        })
      )
    case 'local':
      // Agent mode needs the host's fast model; without it Hermes answers each turn and no instructions go.
      if (!localLiveAgent() || host.fastModel === false) return null
      return preview(
        liveInstructions({
          lookups: AGENT_LOOKUPS,
          announces: false,
          extra: AGENT_INSTRUCTIONS + clockInstructions(now, timeZone),
          language: lang,
          persona: localLivePersona() ? persona : ''
        }),
        true
      )
    default:
      return null
  }
}
