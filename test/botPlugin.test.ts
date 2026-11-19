import { describe, expect, it } from 'vitest'
import {
  BOT_PLUGIN,
  BOT_PLUGIN_PATH,
  botPluginPath,
  botPluginState,
  newBotStep,
  offersTurnOn,
  turnOnPluginForNewBot
} from '../src/renderer/src/state/botPlugin'
import { STATUS_PATH } from '../src/renderer/src/state/plugin'
import type { PluginStatus } from '../src/renderer/src/state/plugin'

const reported = (capabilities: string[]): PluginStatus => ({
  state: 'reported',
  version: '0.180.0',
  loadedVersion: '0.180.0',
  restartNeeded: false,
  capabilities,
  managedBy: null,
  degraded: []
})

describe('newBotStep', () => {
  it('turns the plugin on wherever the dashboard plugin can, clones included', () => {
    expect(newBotStep(reported([BOT_PLUGIN]), true)).toBe('turnOn')
    expect(newBotStep(reported([BOT_PLUGIN]), false)).toBe('turnOn')
  })
  it('asks a fresh bot to update an older plugin, and says nothing otherwise', () => {
    expect(newBotStep(reported(['session-usage']), true)).toBe('askForUpdate')
    expect(newBotStep(reported(['session-usage']), false)).toBe('nothing')
    expect(newBotStep({ state: 'unknown' }, true)).toBe('nothing')
    expect(newBotStep({ state: 'missing' }, true)).toBe('nothing')
  })
})

describe('botPluginState', () => {
  it('offers Turn On only for a bot with it off that the dashboard can help', () => {
    expect(offersTurnOn(botPluginState({ on: false, can_turn_on: true }))).toBe(true)
    expect(offersTurnOn(botPluginState({ on: true, can_turn_on: true }))).toBe(false)
    expect(offersTurnOn(botPluginState({ on: false, can_turn_on: false }))).toBe(false)
    expect(offersTurnOn(botPluginState(null))).toBe(false)
    expect(offersTurnOn(null)).toBe(false)
  })
  it('names the bot and no profile', () => {
    expect(botPluginPath('a&b')).toBe(`${BOT_PLUGIN_PATH}?name=a%26b`)
  })
})

describe('turnOnPluginForNewBot', () => {
  const host = (on: boolean, post: () => unknown) => {
    const calls: string[] = []
    const http = async (method: string, path: string) => {
      calls.push(`${method} ${path}`)
      if (path === STATUS_PATH) return { ok: true, capabilities: [BOT_PLUGIN] }
      if (method === 'GET') return { on, can_turn_on: true }
      return post()
    }
    return { http, calls }
  }
  it('turns it on for a bot that has it off', async () => {
    const { http, calls } = host(false, () => ({ on: true, can_turn_on: true }))
    expect(await turnOnPluginForNewBot(http, 'furina', true)).toBeNull()
    expect(calls).toEqual([`GET ${STATUS_PATH}`, `GET ${botPluginPath('furina')}`, `POST ${BOT_PLUGIN_PATH}`])
  })
  it('leaves a bot that has it already', async () => {
    const { http, calls } = host(true, () => ({}))
    expect(await turnOnPluginForNewBot(http, 'furina', false)).toBeNull()
    expect(calls).not.toContain(`POST ${BOT_PLUGIN_PATH}`)
  })
  it('says why when Hermes refuses', async () => {
    const { http } = host(false, () => {
      throw new Error('Hermes refused to turn the plugin on: recalled')
    })
    expect(await turnOnPluginForNewBot(http, 'furina', true)).toBe(
      "The Conduit plugin wasn't turned on for this bot: Hermes refused to turn the plugin on: recalled Edit the bot to try again."
    )
  })
})
