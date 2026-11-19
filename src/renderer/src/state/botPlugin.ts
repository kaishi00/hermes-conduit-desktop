/**
 * A bot's Conduit plugin, after the phone's BotPlugin (hermes-conduit issue
 * 2803). Hermes serves a profile's plugin routes only once that profile turns
 * the plugin on, and a bot New Bot makes from a fresh profile hasn't, so its
 * Conduit features answer "Plugin not found". The dashboard's plugin turns it
 * on there (`/profiles/plugin`, plugin 0.180.0+): New Bot asks for every bot
 * it makes, and Edit Bot offers Turn On for one that has it off.
 */
import { t } from '../../../shared/i18n'
import { STATUS_PATH, pluginStatus, type PluginStatus } from './plugin'

export const BOT_PLUGIN = 'bot-plugin'
/** Asked of the dashboard's own profile: the bot's can't answer plugin requests yet. */
export const BOT_PLUGIN_PATH = '/api/plugins/conduit_push/profiles/plugin'
/** Turn On runs Hermes' enable on the host: a few seconds, at most 90 there. */
export const TURN_ON_TIMEOUT_MS = 100_000

export interface BotPluginState {
  /** Hermes serves the plugin for the profile and its chats load it. */
  on: boolean
  /** The dashboard can turn it on there (it runs the main install). */
  canTurnOn: boolean
}

export const botPluginPath = (name: string) => `${BOT_PLUGIN_PATH}?name=${encodeURIComponent(name)}`

export function botPluginState(body: unknown): BotPluginState {
  const json = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  return { on: json.on === true, canTurnOn: json.can_turn_on === true }
}

export const offersTurnOn = (state: BotPluginState | null) => !!state && !state.on && state.canTurnOn

export type NewBotStep = 'turnOn' | 'askForUpdate' | 'nothing'

/** What New Bot does about the plugin once the bot exists, as the phone decides it. */
export function newBotStep(status: PluginStatus, startsFresh: boolean): NewBotStep {
  if (status.state !== 'reported') return 'nothing'
  if (status.capabilities.includes(BOT_PLUGIN)) return 'turnOn'
  return startsFresh ? 'askForUpdate' : 'nothing'
}

type Http = (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs?: number) => Promise<unknown>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Turns the plugin on for the bot: null once it's on, otherwise why not. */
export async function turnOnBotPlugin(http: Http, name: string): Promise<string | null> {
  try {
    return botPluginState(await http('POST', BOT_PLUGIN_PATH, { name }, TURN_ON_TIMEOUT_MS)).on
      ? null
      : t('Hermes still has the plugin off for this bot. Try again.')
  } catch (e) {
    return message(e)
  }
}

/** New Bot's last step: a warning for the save's result, or null. */
export async function turnOnPluginForNewBot(http: Http, name: string, startsFresh: boolean): Promise<string | null> {
  const status = await http('GET', STATUS_PATH, undefined, 12_000)
    .then(pluginStatus)
    .catch((): PluginStatus => ({ state: 'unknown' }))
  const step = newBotStep(status, startsFresh)
  if (step === 'nothing') return null
  if (step === 'askForUpdate') {
    return t("Conduit's features need the Conduit plugin turned on for this bot. Update the plugin, then turn it on in Edit Bot.")
  }
  const state = await http('GET', botPluginPath(name), undefined, 30_000)
    .then(botPluginState)
    .catch(() => null)
  if (state && (state.on || !state.canTurnOn)) return null
  const failure = await turnOnBotPlugin(http, name)
  return failure ? t("The Conduit plugin wasn't turned on for this bot: {error} Edit the bot to try again.", { error: failure }) : null
}
