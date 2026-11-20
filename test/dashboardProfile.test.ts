import { beforeEach, describe, expect, it } from 'vitest'
import {
  dashboardProfilePath,
  dashboardProfileQuery,
  noteDashboardProfiles,
  setDashboardProfilesHost,
  watchDashboardProfiles
} from '../src/renderer/src/state/dashboardProfile'
import type { PluginStatus } from '../src/renderer/src/state/plugin'

beforeEach(() => {
  setDashboardProfilesHost('')
  setDashboardProfilesHost('https://a')
})

describe('routes the dashboard itself answers', () => {
  it('name another profile as conduit_profile, and the dashboard’s own with neither', () => {
    noteDashboardProfiles('https://a', ['dashboard-profiles'])
    expect(dashboardProfilePath('/api/plugins/conduit_push/local-live/status', 'work')).toBe('/api/plugins/conduit_push/local-live/status?conduit_profile=work')
    expect(dashboardProfilePath('/x?session_id=a', 'my bot')).toBe('/x?session_id=a&conduit_profile=my%20bot')
    expect(dashboardProfilePath('/x', 'default')).toBe('/x')
    expect(dashboardProfilePath('/x', undefined)).toBe('/x')
    expect(dashboardProfileQuery('work')).toEqual({ conduit_profile: 'work' })
    expect(dashboardProfileQuery('default')).toEqual({})
  })

  it('keep ?profile= for a plugin that doesn’t list dashboard-profiles, or too old to say', () => {
    noteDashboardProfiles('https://a', ['memory'])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    expect(dashboardProfileQuery('work')).toEqual({ profile: 'work' })
    expect(dashboardProfilePath('/x', 'default')).toBe('/x')
    noteDashboardProfiles('https://a', ['dashboard-profiles'])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?conduit_profile=work')
    noteDashboardProfiles('https://a', null)
    expect(dashboardProfileQuery('work')).toEqual({ profile: 'work' })
  })

  it('send ?profile= until the plugin answers, as the phone does', () => {
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    expect(dashboardProfileQuery('work')).toEqual({ profile: 'work' })
  })

  it('ask again on another dashboard, never taking a late answer from the last one', () => {
    noteDashboardProfiles('https://a', ['dashboard-profiles'])
    setDashboardProfilesHost('https://b')
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    noteDashboardProfiles('https://a', ['dashboard-profiles'])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
  })

  it('ask again after an ask that couldn’t tell, until one answers', async () => {
    const answers: (PluginStatus | null)[] = [null, null, { state: 'reported', version: null, loadedVersion: null, restartNeeded: false, capabilities: ['dashboard-profiles'], managedBy: null, degraded: [] }]
    const waits: number[] = []
    let next = () => {}
    watchDashboardProfiles('https://a', async () => answers.shift() ?? null, (ms, then) => ((waits.push(ms), (next = then)), () => {}))
    const settle = () => new Promise(resolve => setTimeout(resolve, 0))
    await settle()
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    next()
    await settle()
    next()
    await settle()
    expect(waits).toEqual([5_000, 10_000])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?conduit_profile=work')
  })

  it('a stopped watch takes no late answer, and a missing route counts as one', async () => {
    let answer = (_: PluginStatus | null) => {}
    const stop = watchDashboardProfiles('https://a', () => new Promise(resolve => (answer = resolve)))
    stop()
    answer({ state: 'reported', version: null, loadedVersion: null, restartNeeded: false, capabilities: ['dashboard-profiles'], managedBy: null, degraded: [] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    watchDashboardProfiles('https://a', async () => ({ state: 'missing' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
  })
})
