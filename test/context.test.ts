import { describe, expect, it } from 'vitest'
import { noteDashboardProfiles, setDashboardProfilesHost } from '../src/renderer/src/state/dashboardProfile'
import { contextFromUsage, money, normalizedPercent, parseBreakdown, parseSessionUsage, sessionUsagePath } from '../src/renderer/src/state/context'

describe('the Context panel', () => {
  it('reads the window from a usage tick, and an unknown window as no reading', () => {
    expect(contextFromUsage({ context_used: 50_000, context_max: 200_000, context_percent: 25 })).toEqual({ used: 50_000, max: 200_000, percent: 25 })
    expect(contextFromUsage({ context_used: 0, context_max: 0 })).toBeNull()
    expect(contextFromUsage({ input: 5 })).toBeNull()
    expect(contextFromUsage(null)).toBeNull()
  })

  it('takes a percent sent as 0…1 or 0…100, the counts first', () => {
    expect(normalizedPercent(0.4, 0, 100)).toBe(40)
    expect(normalizedPercent(40, 0, 100)).toBe(40)
    expect(normalizedPercent(99, 10, 100)).toBe(10)
    expect(normalizedPercent(150, 0, 0)).toBe(100)
  })

  it('colors the breakdown by Hermes’ names only when they tell the categories apart', () => {
    const distinct = parseBreakdown({ categories: [{ id: 'a', label: 'System', tokens: 10, color: 'blue' }, { id: 'b', label: 'Chat', tokens: 20, color: 'green' }], context_max: 100, context_used: 30 })
    expect(distinct.categories.map(c => c.color)).toEqual(['#60a5fa', '#34d399'])
    expect(distinct.window).toEqual({ used: 30, max: 100, percent: 30 })
    const same = parseBreakdown({ categories: [{ id: 'a', label: 'A', tokens: 1, color: 'amber' }, { id: 'b', label: 'B', tokens: 1, color: 'amber' }] })
    expect(same.categories.map(c => c.color)).toEqual(['#e0ab47', '#6194fa'])
    expect(same.window).toBeNull()
  })

  it('reads the chat’s usage, never showing an unpriced cost as $0', () => {
    expect(parseSessionUsage({ input_tokens: 1200, output_tokens: 300, api_call_count: 4, cost_usd: 0.42, cost_status: 'actual' })).toMatchObject({ input: 1200, output: 300, apiCalls: 4, costUSD: 0.42, costStatus: 'actual' })
    expect(parseSessionUsage({ cost_usd: 0, cost_status: 'unknown' })).toMatchObject({ costUSD: null, costStatus: 'unknown' })
    expect(parseSessionUsage({ cost_status: 'weird' }).costStatus).toBe('unknown')
    expect(money(0.42, 'en-US')).toBe('$0.42')
    expect(money(0.0031, 'en-US')).toBe('$0.0031')
  })

  it('names a non-default profile on the usage route', () => {
    // A plugin that reads ?conduit_profile=; until it answers, ?profile= goes.
    setDashboardProfilesHost('https://usage-test')
    noteDashboardProfiles('https://usage-test', ['dashboard-profiles'])
    expect(sessionUsagePath('abc', 'default')).toBe('/api/plugins/conduit_push/sessions/usage?session_id=abc')
    expect(sessionUsagePath('a b', 'work')).toBe('/api/plugins/conduit_push/sessions/usage?session_id=a%20b&conduit_profile=work')
  })
})
