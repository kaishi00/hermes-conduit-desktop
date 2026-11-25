import { describe, expect, it } from 'vitest'
import { EXCLUSION_TOGGLE, budgets, dayIn, excludedAfter, exclusionChange, nextTime, parseMemory, parseSettings, profileChoices, sortedKinds, weekdays } from '../src/renderer/src/state/pulseSettings'

describe('pulse settings', () => {
  it('reads the plugin state and keeps the shape safe', () => {
    const state = parseSettings({
      enabled: true,
      nudge: 'loud',
      report_times: ['09:00', 'nope', '18:30'],
      night: ['22:00', '07:00'],
      quiet_days: [5, 6, 9, 'x'],
      memory_counts: { promise: 2, fact: 0 },
      home_chat: { id: 'c1', title: 'Pulse', pinned: true },
      recent: [{ at: 1, kind: 'report', state: 'ok' }, null]
    })
    expect(state.enabled).toBe(true)
    expect(state.nudge).toBe('balanced')
    expect(state.reportTimes).toEqual(['09:00', '18:30'])
    expect(state.night).toEqual(['22:00', '07:00'])
    expect(state.quietDays).toEqual([5, 6])
    expect(state.memoryCounts).toEqual({ promise: 2 })
    expect(state.homeChat?.id).toBe('c1')
    expect(state.recent).toHaveLength(1)
    expect(state.privatePushes).toBeNull()
    expect(parseSettings({ night: [] }).night).toBeNull()
  })

  it('lists the other profiles to leave out while Pulse reads every profile', () => {
    // hermes-conduit issue 3241. A plugin without the list offers none.
    expect(parseSettings({ report_profiles: 'all', other_profiles: ['work'] }).excludedProfiles).toBeNull()
    expect(profileChoices(parseSettings({ report_profiles: 'all', other_profiles: ['work'] }))).toEqual([])
    const state = parseSettings({ report_profiles: 'all', other_profiles: ['work', 'default'], excluded_profiles: ['nahida', 5] })
    expect(profileChoices(state)).toEqual([
      { name: 'default', leftOut: false },
      { name: 'nahida', leftOut: true },
      { name: 'work', leftOut: false }
    ])
    expect(excludedAfter(state, 'work', true)).toEqual(['nahida', 'work'])
    expect(excludedAfter(state, 'nahida', true)).toEqual(['nahida'])
    expect(excludedAfter(state, 'nahida', false)).toEqual([])
    // A plugin that takes one name gets only the pick, so a change made elsewhere since the read stays (hermes-conduit issue 3269).
    expect(exclusionChange(state, 'work', true, [EXCLUSION_TOGGLE])).toEqual({ exclude_profile: 'work' })
    expect(exclusionChange(state, 'nahida', false, [EXCLUSION_TOGGLE])).toEqual({ include_profile: 'nahida' })
    expect(exclusionChange(state, 'work', true)).toEqual({ excluded_profiles: ['nahida', 'work'] })
    // Reading only its own profile, there is nothing to leave out; every other profile left out still lists them.
    expect(profileChoices(parseSettings({ report_profiles: 'this', other_profiles: [], excluded_profiles: ['work'] }))).toEqual([])
    expect(profileChoices(parseSettings({ report_profiles: 'all', other_profiles: [], excluded_profiles: ['work'] }))).toEqual([{ name: 'work', leftOut: true }])
  })

  it('adds a report time an hour after the last, never one already listed', () => {
    expect(nextTime([])).toBe('09:00')
    expect(nextTime(['09:00'])).toBe('10:00')
    expect(nextTime(['23:30'])).toBe('00:30')
    expect(nextTime(['10:00', '09:00'])).toBe('11:00')
  })

  it('offers the budgets with the current one added', () => {
    expect(budgets([100, 300], 200)).toEqual([100, 200, 300])
    expect(budgets([100, 300], 0)).toEqual([100, 300])
  })

  it('sorts memory kinds as the phone does and reads items', () => {
    expect(sortedKinds(['zeta', 'fact', 'promise', 'commitment'])).toEqual(['commitment', 'promise', 'fact', 'zeta'])
    expect(parseMemory({ items: [{ id: 3, kind: 'fact', text: 'Birthday' }, { id: 'x' }] })).toEqual([
      { id: 3, kind: 'fact', text: 'Birthday', evidence: '', due: '', mentionedAt: 0 }
    ])
  })

  it('names days in the plugin time zone and weeks from Monday 0', () => {
    expect(dayIn('UTC', Date.UTC(2026, 10, 18, 23, 30))).toBe('2026-11-18')
    expect(dayIn('Asia/Tokyo', Date.UTC(2026, 10, 18, 23, 30))).toBe('2026-11-19')
    const days = weekdays('en-GB')
    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({ day: 0, name: 'Monday' })
  })
})
