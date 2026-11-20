/**
 * Settings > Models, after the phone's Models & providers: the model new
 * chats start on, and the helper models, the smaller jobs Hermes runs beside
 * a profile's chats (titles, compaction, image reading and the rest of
 * /api/model/auxiliary), each on the chat model unless it has one of its own.
 */
import { t } from '../../../shared/i18n'
import { valueAt } from './profileConfig'

export interface HelperSlot {
  task: string
  title: string
  caption: string
  provider: string
  model: string
  /** A slot that follows another while unpinned: that slot's title. */
  follows?: string
}

export interface ModelSettings {
  main: { provider: string; model: string }
  slots: HelperSlot[]
}

/** Slots set elsewhere in Conduit: Pulse's memory runs on the main profile, set in Settings > Pulse. */
const SET_ELSEWHERE = new Set(['pulse_memory'])

/** Hermes' group router: who answers in a group chat set to pick automatically (hermes-conduit#2909). */
export const GROUP_ROUTER = 'group_router'

/**
 * Slots Hermes reads only from the default profile: it asks the default profile's `group_router` for every
 * auto-routed room, so another profile's list leaves it out.
 */
const DEFAULT_PROFILE_ONLY = new Set([GROUP_ROUTER])

/** Hermes labels its own slots in its web page, not in the answer, so Conduit names them. */
function builtIn(task: string): { title: string; caption: string } | null {
  switch (task) {
    case 'vision':
      return { title: t('Image reading'), caption: t("Reads pictures and screenshots for a chat model that can't see them.") }
    case 'compression':
      return { title: t('Compaction'), caption: t("Summarizes a long chat so it still fits the model's context.") }
    case 'skills_hub':
      return { title: t('Skill search'), caption: t('Finds skills in the Skills Hub.') }
    case 'approval':
      return { title: t('Smart approvals'), caption: t('Decides which commands are safe to run without asking you, when smart approvals are on.') }
    case 'mcp':
      // Hermes runs it only when an MCP server asks for a completion (sampling/createMessage); the chat model picks tools (hermes-conduit#2877).
      return { title: t('MCP sampling'), caption: t('Answers when an MCP server asks Hermes’ model to write something. It doesn’t choose tools.') }
    case 'title_generation':
      return { title: t('Chat titles'), caption: t('Names new chats.') }
    case 'review':
      return { title: t('Code review'), caption: t("Runs the /review command's reviewer.") }
    case 'voice_chat':
      return {
        title: t('Voice replies'),
        caption: t(
          "The model Hermes answers you with in a voice conversation. Reasoning is off by default so replies start sooner; typed messages keep the chat's model. Hermes Desktop uses this setting too."
        )
      }
    case 'triage_specifier':
      return { title: t('Kanban task details'), caption: t("Fills in a new Kanban task's details.") }
    case 'kanban_decomposer':
      return { title: t('Kanban task splitting'), caption: t('Splits a Kanban task into smaller ones.') }
    case 'profile_describer':
      return { title: t('Profile descriptions'), caption: t("Writes a profile's description.") }
    case 'curator':
      return { title: t('Skill curator'), caption: t('Reviews how skills are used and suggests improvements.') }
    case 'background_review':
      // Listed by the Conduit plugin from 0.184.0 until Hermes lists it (hermes-conduit#2871).
      return {
        title: t('Background review'),
        caption: t(
          'Every few turns, looks back over a chat to decide what goes into memory and which skills to improve. Its reasoning applies only on a model of its own, which starts without the chat’s prompt cache.'
        )
      }
    case 'group_router':
      // Listed by the Conduit plugin from 0.186.0 until Hermes lists it (hermes-conduit#2909).
      return {
        title: t('Group router'),
        caption: t(
          'Picks who answers a message that names nobody, in group chats set to pick automatically. Hermes uses this profile’s choice for every group chat on this Hermes.'
        )
      }
    case 'conduit_predict':
      return { title: t('Conduit predictions'), caption: t('Suggested replies and draft guesses in Conduit, when Predictive uses the fast model.') }
    case 'conduit_work_watch':
      return {
        title: t('Conduit work watch'),
        caption: t('Reads what a bot’s workstreams report while they work and tells its Bot Chat when one may affect another.')
      }
    default:
      return null
  }
}

/** A counter in the profile's config: the helper runs each time it reaches this many; 0 turns that kind of run off. */
export interface HelperInterval {
  key: string
  defaultValue: number
  label: string
  caption: string
}

/** A helper's own on/off switch, in its `auxiliary.<task>` block, and the intervals that decide when it runs while on. */
export interface HelperSwitch {
  key: string
  defaultValue: boolean
  title: string
  label: string
  caption: string
  intervals: HelperInterval[]
}

/**
 * The helpers with an on/off switch of their own: Background review's, its biggest cost lever (hermes-conduit#2871).
 * Hermes checks two counters after each turn and reviews only when one reaches its interval (`memory.nudge_interval`,
 * user turns, for memory; `skills.creation_nudge_interval`, tool-calling steps, for skills; both 10 by default, 0 off),
 * so they show under it (hermes-conduit#2905).
 */
export function helperSwitch(task: string): HelperSwitch | null {
  if (task !== 'background_review') return null
  return {
    key: 'auxiliary.background_review.enabled',
    defaultValue: true,
    title: t('Automatic review'),
    label: t('On'),
    caption: t('Runs when the memory or skill interval below is reached. Off, Hermes reviews a chat only when you ask with /refine.'),
    intervals: [
      {
        key: 'memory.nudge_interval',
        defaultValue: 10,
        label: t('Messages between memory reviews'),
        caption: t('How many of your messages before Hermes looks for what to remember about you. 0 turns memory review off.')
      },
      {
        key: 'skills.creation_nudge_interval',
        defaultValue: 10,
        label: t('Tool steps between skill reviews'),
        caption: t('How many tool-using steps before Hermes looks for a skill to create or improve. 0 turns skill review off.')
      }
    ]
  }
}

/** The switch's value in a profile's config; unset, Hermes runs it. */
export const switchValue = (config: unknown, words: HelperSwitch): boolean => {
  const value = valueAt(config, words.key)
  return typeof value === 'boolean' ? value : words.defaultValue
}

/** An interval as Hermes reads it (`int()` of the value); unset or unreadable, Hermes' default. */
export const intervalValue = (config: unknown, interval: HelperInterval): number => {
  const value = valueAt(config, interval.key)
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) return Number.parseInt(value, 10)
  return interval.defaultValue
}

/** What someone typed in an interval's field: a whole number, 0 or more; null otherwise. */
export const parseInterval = (raw: string): number | null => (/^\s*\d{1,9}\s*$/.test(raw) ? Number.parseInt(raw, 10) : null)

/** A slot a newer Hermes added: its label, else its key made readable. */
function slotTitle(task: string, label: string): string {
  const known = builtIn(task)
  if (known) return known.title
  if (label.trim()) return label.trim()
  const spaced = task.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** `profile` other than the default leaves out the slots only the default profile's config sets. */
export function parseModelSettings(raw: unknown, profile = 'default'): ModelSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  const main = (o.main && typeof o.main === 'object' ? o.main : {}) as Row
  const rows = (Array.isArray(o.tasks) ? o.tasks : []).filter((r): r is Row => !!r && typeof r === 'object')
  const titles = new Map(rows.map(row => [str(row.task), slotTitle(str(row.task), str(row.label))]))
  const seen = new Set<string>()
  const slots: HelperSlot[] = []
  for (const row of rows) {
    const task = str(row.task).trim()
    if (!task || seen.has(task) || SET_ELSEWHERE.has(task)) continue
    if (profile !== 'default' && DEFAULT_PROFILE_ONLY.has(task)) continue
    seen.add(task)
    const inherits = str(row.inherit_from)
    slots.push({
      task,
      title: titles.get(task) ?? task,
      caption: builtIn(task)?.caption ?? str(row.hint),
      provider: str(row.provider),
      model: str(row.model),
      follows: inherits ? (titles.get(inherits) ?? inherits) : undefined
    })
  }
  return { main: { provider: str(main.provider), model: str(main.model) }, slots }
}

/** A slot with a model of its own; "auto" with no model is the chat model. */
export const hasOwnModel = (slot: HelperSlot) => !!slot.model && slot.provider !== 'auto'

/** The default profile's Group router slot in its /api/model/auxiliary answer, or null before plugin 0.186.0. */
export const groupRouterSlot = (raw: unknown): HelperSlot | null => parseModelSettings(raw).slots.find(slot => slot.task === GROUP_ROUTER) ?? null

/** "All use the chat model", or how many have one of their own. */
export function helperSummary(slots: HelperSlot[]): string {
  const own = slots.filter(hasOwnModel).length
  return own ? t('{own} of {all} have a model of their own', { own: String(own), all: String(slots.length) }) : t('All use the chat model')
}
