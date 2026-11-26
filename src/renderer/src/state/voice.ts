/**
 * Voice in the composer and under replies, after the phone's: a recording
 * typed out by Hermes' transcription (dictation), sent as a voice message
 * (the audio as a file, the prompt saying what was said), and a reply read
 * aloud by Hermes' speech. These are Hermes' own routes, the ones Hermes
 * Desktop's voice uses, so they speak with the voice set up in Hermes.
 */
import { t } from '../../../shared/i18n'
import { gateway } from '../gateway'
import { withSpokenCards } from './desktopCards'
import { withPagesSaid } from './htmlInReplies'

/** The file name a voice message gets, as the phone names it, so the chat shows it as one. */
export const VOICE_FILE_PREFIX = 'voice-message-'

const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/** Hermes Desktop's transcription wait: three minutes at least, longer for a long recording, never past ten. */
export function transcriptionTimeout(dataUrlLength: number): number {
  return Math.min(600_000, Math.max(180_000, Math.ceil(dataUrlLength * 0.1)))
}

/** "0:14", "12:03", "1:02:03". */
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** The prompt sent with a voice message, in English like Hermes' own attachment notes, as the phone words it. */
export function voicePromptText(seconds: number, transcript: string): string {
  const length = durationLabel(seconds)
  const words = transcript.trim()
  return words ? `[Voice message, ${length}. Transcript:]\n${words}` : `[Voice message, ${length}. No transcript: listen to the attached audio file if you can.]`
}

/** A sent voice message's length and words, or null for any other message. */
export function parseVoiceMessage(text: string): { duration: string; transcript: string } | null {
  const match = /^\[Voice message, (\d+:\d{2}(?::\d{2})?)(?:\.[^\]\n]*)?\][ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return null
  return { duration: match[1]!, transcript: text.slice(match[0].length).trim() }
}

/** A voice message's file name. */
export function voiceFileName(extension: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${VOICE_FILE_PREFIX}${stamp}.${extension}`
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** What Hermes heard: "" for silence, which isn't an error. */
export async function transcribe(base64: string, mime: string, profile?: string): Promise<string> {
  const dataUrl = `data:${mime};base64,${base64}`
  const answer = await gateway.http<{ transcript?: unknown; text?: unknown; error?: unknown }>(
    'POST',
    withProfile('/api/audio/transcribe', profile),
    { data_url: dataUrl, mime_type: mime },
    transcriptionTimeout(dataUrl.length)
  )
  if (typeof answer?.error === 'string' && answer.error) throw new Error(answer.error)
  const words = typeof answer?.transcript === 'string' ? answer.transcript : typeof answer?.text === 'string' ? answer.text : ''
  return words.trim()
}

/** A reply as Hermes' speech says it: the words, without Markdown's marks, code, tags or links' addresses; a page said to be one. */
export function spokenText(markdown: string): string {
  return withPagesSaid(withSpokenCards(markdown), t('(There’s a page here.)'))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Speech for `text`, as a data: URL to play. */
export async function speak(text: string, profile?: string): Promise<string> {
  const answer = await gateway.http<{ data_url?: unknown; dataUrl?: unknown; error?: unknown }>('POST', withProfile('/api/audio/speak', profile), { text }, 120_000)
  if (typeof answer?.error === 'string' && answer.error) throw new Error(answer.error)
  const url = typeof answer?.data_url === 'string' ? answer.data_url : typeof answer?.dataUrl === 'string' ? answer.dataUrl : ''
  if (!url.startsWith('data:audio/')) throw new Error(t('Hermes returned invalid fallback audio.'))
  return url
}
