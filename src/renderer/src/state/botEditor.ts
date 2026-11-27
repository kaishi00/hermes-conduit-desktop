/**
 * Edit Bot, after the phone's: the bot's face and color, name, description
 * and personality (SOUL.md), its model, and the skills, tools and MCP
 * servers it may use. The look goes in `ui_meta['hermes-bots']` as a
 * compare-and-swap against the roster's copy; the rest through
 * `profiles.configure`'s own sections; the picture through the asset store.
 */
import { t } from '../../../shared/i18n'
import { STARTER_FACES, starterFace, type StarterFace } from './starterFaces'
import type { Bot } from './bots'

/** Keys that never travel in ui_meta: data URLs go to the asset store, and `chat` is a dead pointer Desktop deletes on sight. */
const STRIPPED = ['image', 'pet', 'chat']

/**
 * The full `hermes-bots` value to write. The gateway replaces the key
 * wholesale, so every field another client stored is carried over and only
 * the patched fields change. An undefined patch value deletes the field.
 */
export function mergedMeta(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete result[key]
    else result[key] = value
  }
  for (const key of STRIPPED) delete result[key]
  return result
}

export type MetaOutcome = 'persisted' | 'conflict' | 'failed' | 'unsupported'

export function metaOutcome(result: unknown): MetaOutcome {
  const applied = (result as { applied?: unknown } | null)?.applied
  if (!applied || typeof applied !== 'object') return 'unsupported'
  const a = applied as Record<string, unknown>
  if (a.ui_meta === true) return 'persisted'
  if (a.ui_meta_conflicts && typeof a.ui_meta_conflicts === 'object' && Object.keys(a.ui_meta_conflicts).length) return 'conflict'
  return 'failed'
}

/** The sections a `profiles.configure` answer says failed. */
export function failedSections(result: unknown, sections: string[]): string[] {
  const applied = ((result as { applied?: unknown } | null)?.applied ?? {}) as Record<string, unknown>
  return sections.filter(section => applied[section] === false)
}

// The face

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const h = (((hue % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  const m = lightness - c / 2
  return `#${[r, g, b]
    .map(v =>
      byte(v + m)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The face's color as a bot's color is written in ui_meta, as the phone writes it. */
export function faceHex(face: StarterFace): string {
  return hslToHex(face.hue, face.saturation, face.saturation < 0.3 ? 0.5 : 0.58)
}

const FACE_NAMES = ['Purple', 'Sky Blue', 'Orange', 'Mint', 'Yellow', 'Pink', 'Blue', 'Cyan', 'Red', 'Lime', 'Magenta', 'Gray'] as const

/** A face's name, by its color, for screen readers. */
export function faceName(index: number): string {
  switch (FACE_NAMES[index]) {
    case 'Purple':
      return t('Purple')
    case 'Sky Blue':
      return t('Sky Blue')
    case 'Orange':
      return t('Orange')
    case 'Mint':
      return t('Mint')
    case 'Yellow':
      return t('Yellow')
    case 'Pink':
      return t('Pink')
    case 'Blue':
      return t('Blue')
    case 'Cyan':
      return t('Cyan')
    case 'Red':
      return t('Red')
    case 'Lime':
      return t('Lime')
    case 'Magenta':
      return t('Magenta')
    case 'Gray':
      return t('Gray')
    default:
      return t('Face')
  }
}

export const FACE_COUNT = STARTER_FACES.length

/** The face the phone stored for the bot, if any. */
export function storedFace(meta: Record<string, unknown>): number | undefined {
  const value = meta.face
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

// What the editor holds

export interface Capability {
  name: string
  enabled: boolean
  label?: string
  description?: string
}

export interface Capabilities {
  skills: Capability[]
  toolsets: Capability[]
  mcpServers: Capability[]
}

export interface BotDetails {
  description: string
  soul: string
  provider: string
  model: string
  capabilities: Capabilities
}

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []
const text = (value: unknown) => (typeof value === 'string' ? value : '')

function capabilities(value: unknown): Capability[] {
  const seen = new Set<string>()
  const out: Capability[] = []
  for (const row of rows(value)) {
    const name = text(row.name).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      // Hermes leaves `enabled` out for what's on.
      enabled: row.enabled !== false,
      label: text(row.label).trim() || undefined,
      description: text(row.description).trim() || undefined
    })
  }
  return out
}

/** `profiles.describe`'s answer. */
export function parseDetails(raw: unknown): BotDetails {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const model = (o.model && typeof o.model === 'object' ? o.model : {}) as Record<string, unknown>
  return {
    description: text(o.description),
    soul: text(o.soul),
    provider: text(model.provider),
    model: text(model.default),
    capabilities: { skills: capabilities(o.skills), toolsets: capabilities(o.toolsets), mcpServers: capabilities(o.mcp_servers) }
  }
}

const enabledNames = (list: Capability[]) =>
  list
    .filter(c => c.enabled)
    .map(c => c.name)
    .sort()
    .join('\n')

/** The configure sections for what changed: skills by what's off, toolsets and MCP by what's on (every toolset on is Hermes' default, sent as none). */
export function capabilityParams(original: Capabilities, edited: Capabilities): Record<string, string[]> {
  const params: Record<string, string[]> = {}
  if (enabledNames(edited.skills) !== enabledNames(original.skills)) params.disabled_skills = edited.skills.filter(c => !c.enabled).map(c => c.name)
  if (enabledNames(edited.toolsets) !== enabledNames(original.toolsets)) {
    const on = edited.toolsets.filter(c => c.enabled).map(c => c.name)
    params.enabled_toolsets = on.length === edited.toolsets.length ? [] : on
  }
  if (enabledNames(edited.mcpServers) !== enabledNames(original.mcpServers))
    params.enabled_mcp_servers = edited.mcpServers.filter(c => c.enabled).map(c => c.name)
  return params
}

/** Turns one capability on or off by name. The last toolset on stays on: no tools would save as Hermes' defaults. */
export function setCapability(caps: Capabilities, list: keyof Capabilities, name: string, on: boolean): Capabilities {
  const rows = caps[list]
  if (list === 'toolsets' && !on && rows.filter(c => c.enabled).length <= 1 && rows.find(c => c.name === name)?.enabled) return caps
  return { ...caps, [list]: rows.map(c => (c.name === name ? { ...c, enabled: on } : c)) }
}

/** "12 of 20 on". */
export function onSummary(list: Capability[]): string {
  return t('{on} of {all} on', { on: String(list.filter(c => c.enabled).length), all: String(list.length) })
}

export interface Draft {
  title: string
  face?: number
  color?: string
  description: string
  soul: string
  provider: string
  model: string
  capabilities?: Capabilities
  /** A new picture, as a PNG data URL. */
  picture?: string
  removePicture: boolean
  /** The category it's filed under (state/botCategories.ts), '' for none. */
  category: string
}

export function draftFor(bot: Bot): Draft {
  return {
    title: typeof bot.meta.title === 'string' ? bot.meta.title : '',
    face: storedFace(bot.meta),
    color: bot.color,
    description: bot.description ?? '',
    soul: '',
    provider: '',
    model: '',
    removePicture: false,
    category: bot.category?.name ?? ''
  }
}

/** The ui_meta fields a save changes, or an empty patch. */
export function metaPatch(bot: Bot, draft: Draft): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const title = draft.title.trim()
  const kept = typeof bot.meta.title === 'string' ? bot.meta.title.trim() : ''
  if (title !== kept) patch.title = title || undefined
  if (draft.color !== bot.color) {
    patch.color = draft.color
    patch.custom = true
  }
  if (draft.face !== undefined && draft.face !== storedFace(bot.meta)) patch.face = draft.face
  return patch
}

/** The face a draft shows: the picked one, else the bot's own. */
/**
 * Whether a bot's look patch changes only its Category (`sectionId`/`sectionName`), read before a picture's own
 * fields join it: a failed save then says the change wasn't saved rather than naming the name or color.
 */
export function categoryOnlyPatch(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every(key => key === 'sectionId' || key === 'sectionName')
}

export function shownFace(bot: Bot, draft: Draft): StarterFace {
  return starterFace(draft.face ?? bot.face)
}

/** A picture file as the square 256 px PNG Hermes keeps (Desktop's and the phone's normalization; the store caps at 2 MB). */
export async function normalizedPicture(file: Blob, edge = 256): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = edge
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}
