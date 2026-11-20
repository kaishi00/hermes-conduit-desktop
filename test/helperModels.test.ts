import { describe, expect, it } from 'vitest'
import {
  groupRouterSlot,
  hasOwnModel,
  helperSummary,
  helperSwitch,
  intervalValue,
  parseInterval,
  parseModelSettings,
  switchValue
} from '../src/renderer/src/state/helperModels'

describe('parseModelSettings', () => {
  const raw = {
    main: { provider: 'openrouter', model: 'anthropic/claude' },
    tasks: [
      { task: 'vision', provider: 'auto', model: '', label: 'Vision', hint: 'x' },
      { task: 'compression', provider: 'openrouter', model: 'small', inherit_from: 'vision' },
      { task: 'pulse_memory', provider: 'auto', model: '' },
      { task: 'vision', provider: 'x', model: 'dup' },
      { task: 'new_thing', provider: 'auto', model: '', label: '', hint: 'A newer slot.' },
      { task: 'labelled', provider: 'auto', model: '', label: ' Fancy ' },
      null
    ]
  }

  it('keeps the main model and one slot per task, leaving out the ones set elsewhere', () => {
    const settings = parseModelSettings(raw)
    expect(settings.main).toEqual({ provider: 'openrouter', model: 'anthropic/claude' })
    expect(settings.slots.map(slot => slot.task)).toEqual(['vision', 'compression', 'new_thing', 'labelled'])
  })

  it('names known slots, a newer one by its label or key, and who a slot follows', () => {
    const [vision, compression, newer, labelled] = parseModelSettings(raw).slots
    expect(vision.title).toBe('Image reading')
    expect(compression.follows).toBe('Image reading')
    expect(newer.title).toBe('New thing')
    expect(newer.caption).toBe('A newer slot.')
    expect(labelled.title).toBe('Fancy')
  })

  it('counts slots with a model of their own', () => {
    const { slots } = parseModelSettings(raw)
    expect(slots.filter(hasOwnModel).map(slot => slot.task)).toEqual(['compression'])
    expect(helperSummary(slots)).toBe('1 of 4 have a model of their own')
    expect(helperSummary(slots.filter(slot => !hasOwnModel(slot)))).toBe('All use the chat model')
  })

  it('reads nothing as empty', () => {
    expect(parseModelSettings(null)).toEqual({ main: { provider: '', model: '' }, slots: [] })
  })
})

describe('background review and MCP sampling', () => {
  it('names background review, with its switch, and says what the MCP slot does', () => {
    const [mcp, review] = parseModelSettings({ tasks: [{ task: 'mcp' }, { task: 'background_review', provider: 'openrouter', model: 'fast' }] }).slots
    expect(mcp.title).toBe('MCP sampling')
    expect(mcp.caption).toContain('doesn’t choose tools')
    expect(helperSwitch('mcp')).toBeNull()
    expect(review.title).toBe('Background review')
    const words = helperSwitch(review.task)!
    expect(words.key).toBe('auxiliary.background_review.enabled')
    expect(switchValue({ auxiliary: { background_review: { enabled: false } } }, words)).toBe(false)
    expect(switchValue({ auxiliary: { background_review: {} } }, words)).toBe(true)
    expect(switchValue(null, words)).toBe(true)
    // It runs when a counter reaches its interval, not after every turn, so both show under the switch (hermes-conduit#2905).
    expect(words.intervals.map(i => i.key)).toEqual(['memory.nudge_interval', 'skills.creation_nudge_interval'])
    const [memory] = words.intervals
    expect(intervalValue(null, memory)).toBe(10)
    expect(intervalValue({ memory: { nudge_interval: 20 } }, memory)).toBe(20)
    expect(intervalValue({ memory: { nudge_interval: 0 } }, memory)).toBe(0)
    expect(intervalValue({ memory: { nudge_interval: '30' } }, memory)).toBe(30)
    expect(intervalValue({ memory: { nudge_interval: 'often' } }, memory)).toBe(10)
    expect(parseInterval(' 25 ')).toBe(25)
    expect(parseInterval('0')).toBe(0)
    expect(parseInterval('-1')).toBeNull()
    expect(parseInterval('2.5')).toBeNull()
    expect(parseInterval('')).toBeNull()
  })
})

describe('group router', () => {
  const raw = {
    tasks: [
      { task: 'vision', provider: 'auto', model: '' },
      { task: 'group_router', provider: 'openrouter', model: 'fast/router' }
    ]
  }

  it('is named and listed only for the default profile, which Hermes reads for every room (hermes-conduit#2909)', () => {
    const slots = parseModelSettings(raw).slots
    expect(slots.map(slot => slot.task)).toEqual(['vision', 'group_router'])
    expect(slots[1].title).toBe('Group router')
    expect(helperSwitch('group_router')).toBeNull()
    expect(parseModelSettings(raw, 'default').slots).toHaveLength(2)
    expect(parseModelSettings(raw, 'second').slots.map(slot => slot.task)).toEqual(['vision'])
  })

  it('gives Group Settings its slot, or nothing before the plugin lists it', () => {
    expect(groupRouterSlot(raw)?.model).toBe('fast/router')
    expect(groupRouterSlot({ tasks: [{ task: 'vision', provider: 'auto', model: '' }] })).toBeNull()
    expect(groupRouterSlot(undefined)).toBeNull()
  })
})
