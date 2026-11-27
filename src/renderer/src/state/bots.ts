/**
 * Bots: every Hermes profile, as the gateway's `profiles.list` lists them,
 * with the look Hermes Desktop and the phone keep in `ui_meta['hermes-bots']`
 * (title, color, pinned, hidden, category) and the picture in the profile's asset store
 * (`profiles.get_asset`, asset `avatar`).
 */
import { cleanTitle, plainLine, previewText } from './text'
import { silenceShown } from './silence'
import { toMillis } from './chats'
import { assignFaces, faceColor, starterFace } from './starterFaces'
import { categoryOf, type BotCategory } from './botCategories'

import { BOTS_META_KEY } from '../../../shared/botsMeta'
export { BOTS_META_KEY }

export interface Bot {
  name: string
  title: string
  description?: string
  model?: string
  color?: string
  pinned: boolean
  hidden: boolean
  isDefault: boolean
  hasAvatar: boolean
  /** The starter face it wears while it has no picture (the phone's StarterFaces). */
  face: number
  /** The profile's Bot Chat, its one long-running chat, when it has one. */
  botChatId?: string
  /** Its newest chat's last line and time. */
  lastLine?: string
  lastActive?: number
  /** `ui_meta['hermes-bots']` as Hermes keeps it, carried whole into a write. */
  meta: Record<string, unknown>
  /** That key's revision, for the write's compare-and-swap. */
  metaRevision?: number
  /** Its category: Hermes Desktop's section (`sectionId`, `sectionName`), see botCategories.ts. */
  category?: BotCategory
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The name a bot goes by, as the phone's displayLabel: its title, else the
 * profile's display name, else its id capitalized. A display name that is
 * only the id names it no more than the id, and the main profile nobody
 * named is Hermes, never Default.
 */
export function botTitle(given: string | undefined, name: string, isDefault: boolean, displayName?: string): string {
  const title = given ? cleanTitle(given) : ''
  if (title) return title
  const shown = displayName ? cleanTitle(displayName) : ''
  if (isDefault && (!shown || shown.toLowerCase() === name.toLowerCase() || shown.toLowerCase() === 'default')) return 'Hermes'
  if (shown && shown !== name) return shown
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function botsFromProfiles(body: unknown): Bot[] {
  return rosterFromProfiles(body).bots
}

export interface Roster {
  /** The bots shown, in display order. */
  bots: Bot[]
  /** Bots hidden from the list (ui_meta `hidden`, as Desktop hides them): they keep working. */
  hidden: Bot[]
  /** Hermes adds the messaging section to a bot's SOUL itself (`bot_mode_protocol`). */
  protocol: boolean
}

export function rosterFromProfiles(body: unknown): Roster {
  const protocol = !!body && typeof body === 'object' && (body as { bot_mode_protocol?: unknown }).bot_mode_protocol === true
  const list = body && typeof body === 'object' ? (body as { profiles?: unknown }).profiles : undefined
  if (!Array.isArray(list)) return { bots: [], hidden: [], protocol }
  const bots: Bot[] = []
  const candidates: { name: string; isDefault: boolean; storedFace?: number; created?: number }[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const name = str(row.name)
    if (!name) continue
    const uiMeta = row.ui_meta && typeof row.ui_meta === 'object' ? (row.ui_meta as Record<string, unknown>) : {}
    const meta = uiMeta[BOTS_META_KEY] && typeof uiMeta[BOTS_META_KEY] === 'object' ? (uiMeta[BOTS_META_KEY] as Record<string, unknown>) : {}
    const canonical = row.canonical_session && typeof row.canonical_session === 'object' ? (row.canonical_session as Record<string, unknown>) : null
    const last = row.last_session && typeof row.last_session === 'object' ? (row.last_session as Record<string, unknown>) : null
    const source = canonical ?? last
    const isDefault = row.is_default === true || name.toLowerCase() === 'default'
    const storedFace = typeof meta.face === 'number' && Number.isInteger(meta.face) && meta.face >= 0 ? meta.face : undefined
    const created = typeof meta.created === 'number' ? meta.created : undefined
    candidates.push({ name, isDefault, storedFace, created })
    const revisions = row.ui_meta_revisions && typeof row.ui_meta_revisions === 'object' ? (row.ui_meta_revisions as Record<string, unknown>) : {}
    const revision = revisions[BOTS_META_KEY]
    bots.push({
      name,
      title: botTitle(str(meta.title), name, isDefault, str(row.display_name)),
      description: str(row.description),
      model: str(row.model),
      color: str(meta.color),
      pinned: meta.pinned === true,
      hidden: meta.hidden === true,
      isDefault,
      hasAvatar: row.has_avatar === true,
      face: 0,
      botChatId: str(canonical?.resolved_id) ?? str(canonical?.id),
      lastLine: lastLineOf(str(canonical?.preview)) ?? lastLineOf(str(last?.preview)),
      lastActive: toMillis(source?.last_active) ?? toMillis(last?.last_active),
      meta,
      category: categoryOf(meta),
      metaRevision: typeof revision === 'number' && Number.isInteger(revision) ? revision : undefined
    })
  }
  // Faces go round every bot, hidden ones too, as the phone hands them out.
  const faces = assignFaces(candidates)
  for (const bot of bots) bot.face = faces.get(bot.name) ?? 0
  return { bots: displayOrder(bots.filter(b => !b.hidden)), hidden: bots.filter(b => b.hidden), protocol }
}

/** Pinned first, otherwise in Hermes' own order (pinned, then recent activity), as the phone shows them until the person sets one. */
export function displayOrder(bots: Bot[]): Bot[] {
  return [...bots.filter(b => b.pinned), ...bots.filter(b => !b.pinned)]
}

/** A chat's preview as a bot's last line, or undefined when it's only a system or scheduled-job note. */
export function lastLineOf(preview: string | undefined): string | undefined {
  if (!preview) return undefined
  // Hermes' silence marker is no line of the bot's, nor one closing a reply (issue 2700).
  const text = silenceShown(preview).trim()
  if (!text) return undefined
  if (/^\[(?:System\b|Cron job\b|Scheduled\b)/i.test(text)) return undefined
  return plainLine(previewText(text), 240) || undefined
}

/** A `profiles.get_asset` answer as an image URL, or null when there's no picture. */
export function avatarUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { found?: unknown; mime?: unknown; data?: unknown }
  if (r.found !== true || typeof r.data !== 'string' || !r.data) return null
  if (r.data.startsWith('data:')) return r.data
  const mime = typeof r.mime === 'string' && r.mime.startsWith('image/') ? r.mime : 'image/png'
  return `data:${mime};base64,${r.data}`
}

const NAMED_COLORS = new Set(['blue', 'brown', 'cyan', 'green', 'indigo', 'mint', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'])
const MINT = '#00c7be'

/** The color Hermes keeps for the bot as CSS (hex, hsl(), rgb() or a named color), or undefined when it has none. */
export function keptColor(color: string | undefined): string | undefined {
  const value = color?.trim()
  if (!value) return undefined
  if (/^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value.startsWith('#') ? value : `#${value}`
  if (/^(?:hsla?|rgba?)\([\d.\s,%/deg+-]+\)$/i.test(value)) return value
  const named = value.toLowerCase()
  if (NAMED_COLORS.has(named)) return named === 'mint' ? MINT : named
  return undefined
}

/** The bot's color: the one Hermes keeps for it, else its starter face's. */
export function botColor(bot: Pick<Bot, 'color' | 'face'>): string {
  return keptColor(bot.color) ?? faceColor(starterFace(bot.face))
}

/**
 * Each dashboard's roster as last read in this window, so switching between
 * combined dashboards draws its bots at once, its own and the other's, while
 * they're read again.
 */
export const keptRosters = new Map<string, { bots: Bot[]; hidden: Bot[]; protocol: boolean; at: number }>()
