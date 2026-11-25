/**
 * What voice leaves in the Chats list, after the phone's "Voice in the chats
 * list": the plugin tags each saved call's row, each chat Classic voice made
 * and each voice job's chat (`voice/tags`), and lists the chats every call
 * was kept with (`chat_calls`). Tagged rows file under Voice or Voice Jobs,
 * a chat a call was kept with is under Voice too while it keeps its own
 * source, and a call's row says its engine, a job's the chat it came from.
 * The plugin archives a call's row, a chat Classic made and a settled job's
 * chat so Hermes Desktop's list keeps only the chats people work in
 * (Hermes' auto-archive stamp); this list shows them as if they weren't.
 */
import { useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { t } from '../../../shared/i18n'
import type { ChatRow } from './chats'
/** The plugin's voice tags (voiceCalls.ts reads its chat_calls too); kept here so voiceJobs.ts can tag without importing the live calls. */
const TAGS_PATH = '/api/plugins/conduit_push/voice/tags'

export type VoiceTagKind = 'call' | 'classic' | 'job'

export interface VoiceTag {
  kind: VoiceTagKind
  engine: string | null
  parentId: string | null
  parentTitle: string | null
}

export interface VoiceList {
  /** By profile (lowercase), then session id. */
  tags: Map<string, Map<string, VoiceTag>>
  /** By profile (lowercase): the chats a call was kept with. */
  callChats: Map<string, Set<string>>
}

/** The end reason Conduit gives a saved call's row. */
export const VOICE_CALL_END_REASON = 'conduit_voice'

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)
const profileKey = (profile?: string) => (profile || 'default').toLowerCase()

/** One profile's `voice/tags` answer. */
export function parseVoiceTags(response: unknown): { tags: Map<string, VoiceTag>; callChats: Set<string> } {
  const body = (response ?? {}) as Row
  const tags = new Map<string, VoiceTag>()
  const raw = body.tags
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Row)) {
      const tag = (value ?? {}) as Row
      const kind = tag.kind
      if (kind !== 'call' && kind !== 'classic' && kind !== 'job') continue
      tags.set(id, { kind, engine: text(tag.engine), parentId: text(tag.parent_id), parentTitle: text(tag.parent_title) })
    }
  }
  const callChats = new Set<string>()
  if (Array.isArray(body.chat_calls)) for (const entry of body.chat_calls as Row[]) if (entry && typeof entry.chat_id === 'string') callChats.add(entry.chat_id)
  return { tags, callChats }
}

const tagOf = (row: ChatRow, voice: VoiceList) => {
  const tags = voice.tags.get(profileKey(row.profile))
  return tags?.get(row.id) ?? (row.lineageRoot ? tags?.get(row.lineageRoot) : undefined)
}

/** A row the plugin archived for voice: auto-archived, and a saved call's row or a chat Classic or a job made. */
export function isArchivedVoiceChat(row: ChatRow, voice: VoiceList): boolean {
  if (!row.autoArchived) return false
  if (row.endReason === VOICE_CALL_END_REASON) return true
  const kind = tagOf(row, voice)?.kind
  return kind === 'classic' || kind === 'job'
}

function engineName(engine: string | null): string {
  switch (engine) {
    case 'gemini-live':
      return t('Gemini Live')
    case 'qwen-live':
      return t('Qwen Live')
    case 'gpt-live':
      return t('GPT-Live')
    case 'grok-live':
      return t('Grok Live')
    case 'local-live':
      return t('Local Live')
    default:
      return t('Voice call')
  }
}

/**
 * The list's rows with voice's: the archived voice rows listed among them
 * by recency, tagged rows filed under Voice or Voice Jobs with the line
 * voice says, and a chat a call was kept with marked for the Voice filter.
 */
export function withVoice(rows: ChatRow[], archived: ChatRow[], voice: VoiceList): ChatRow[] {
  const ids = new Set(rows.map(r => r.id))
  const extra = archived.filter(r => !ids.has(r.id) && isArchivedVoiceChat(r, voice))
  const all = extra.length ? [...rows, ...extra].sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0)) : rows
  if (!voice.tags.size && !voice.callChats.size) return all
  return all.map(row => {
    const tag = tagOf(row, voice)
    const calls = voice.callChats.get(profileKey(row.profile))?.has(row.id) ?? false
    if (!tag && !calls) return row
    const next: ChatRow = { ...row, hasVoiceCalls: calls || undefined }
    if (!tag) return next
    next.sourceKind = tag.kind === 'job' ? 'voice_job' : 'voice'
    if (tag.kind === 'call') next.preview = engineName(tag.engine)
    if (tag.kind === 'job') {
      const parent = tag.parentId ? all.find(r => r.id === tag.parentId || r.lineageRoot === tag.parentId) : undefined
      const title = parent?.title ?? tag.parentTitle
      if (title) next.preview = t('From {name}', { name: title })
      // A job nests under the call or chat that started it, as on the phone.
      if (tag.parentId) next.nestUnder = tag.parentId
    }
    return next
  })
}

/** Whether a row is under a source in the Sources filter: Voice also lists every chat a call was kept with. */
export const underSource = (row: ChatRow, source: string) => (row.sourceKind ?? 'chat') === source || (source === 'voice' && !!row.hasVoiceCalls)

/** Files a session under Voice (a chat Classic voice made) or Voice Jobs (a job's chat, under its call's chat). */
export async function tagVoiceSession(
  profile: string | undefined,
  sessionId: string,
  kind: VoiceTagKind,
  parentId?: string | null,
  parentTitle?: string | null
): Promise<void> {
  const body: Record<string, string> = { session_id: sessionId, kind }
  if (parentId) body.parent_id = parentId
  if (parentTitle) body.parent_title = parentTitle
  await gateway.http('POST', withProfile(TAGS_PATH, profile), body, 15_000)
}

/** A chat a Classic call made, archived as the call ends (the plugin checks voice alone used it). */
export async function archiveClassicChat(profile: string | undefined, sessionId: string): Promise<void> {
  await gateway.http('POST', withProfile('/api/plugins/conduit_push/voice/archive', profile), { session_id: sessionId }, 15_000)
}

const EMPTY: VoiceList = { tags: new Map(), callChats: new Map() }

/** Whether two reads of voice's tags say the same, profile by profile. */
export function sameVoice(a: VoiceList, b: VoiceList): boolean {
  if (a.tags.size !== b.tags.size || a.callChats.size !== b.callChats.size) return false
  for (const [profile, tags] of b.tags) {
    const before = a.tags.get(profile)
    if (!before || before.size !== tags.size) return false
    for (const [id, tag] of tags) {
      const old = before.get(id)
      if (!old || old.kind !== tag.kind || old.engine !== tag.engine || old.parentId !== tag.parentId || old.parentTitle !== tag.parentTitle) return false
    }
  }
  for (const [profile, chats] of b.callChats) {
    const before = a.callChats.get(profile)
    if (!before || before.size !== chats.size || [...chats].some(id => !before.has(id))) return false
  }
  return true
}

/** Voice's tags for every profile the list shows, read again when the list changes, at most every 20 seconds. */
export function useVoiceList(connected: boolean, profiles: string[], revision: string): VoiceList {
  const [voice, setVoice] = useState<VoiceList>(EMPTY)
  const last = useRef(0)
  const key = profiles.join('\n')
  useEffect(() => {
    if (!connected || !key) return
    let live = true
    const read = async () => {
      last.current = Date.now()
      const tags = new Map<string, Map<string, VoiceTag>>()
      const callChats = new Map<string, Set<string>>()
      await Promise.all(
        key.split('\n').map(async profile => {
          const answer = await gateway.http('GET', withProfile(TAGS_PATH, profile || undefined)).catch(() => null)
          if (!answer) return
          const parsed = parseVoiceTags(answer)
          tags.set(profileKey(profile), parsed.tags)
          callChats.set(profileKey(profile), parsed.callChats)
        })
      )
      // The same answers keep the list's object, so the chat list isn't worked out again (desktop#543).
      if (live) setVoice(current => (sameVoice(current, { tags, callChats }) ? current : { tags, callChats }))
    }
    const wait = Math.max(0, last.current + 20_000 - Date.now())
    const timer = setTimeout(() => void read(), wait)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [connected, key, revision])
  return voice
}
