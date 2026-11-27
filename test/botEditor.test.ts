import { describe, expect, it } from 'vitest'
import {
  capabilityParams,
  draftFor,
  failedSections,
  faceHex,
  mergedMeta,
  metaOutcome,
  categoryOnlyPatch,
  metaPatch,
  parseDetails,
  setCapability
} from '../src/renderer/src/state/botEditor'
import { botsFromProfiles } from '../src/renderer/src/state/bots'
import { starterFace } from '../src/renderer/src/state/starterFaces'

const roster = botsFromProfiles({
  profiles: [
    {
      name: 'furina',
      description: 'Plans trips',
      ui_meta: { 'hermes-bots': { title: 'Furina', color: '#123456', face: 3, sections: ['a'], image: 'data:...', chat: 'x' } },
      ui_meta_revisions: { 'hermes-bots': 7 }
    }
  ]
})
const bot = roster[0]!

describe('edit bot', () => {
  it('keeps the whole look and its revision from the roster', () => {
    expect(bot.metaRevision).toBe(7)
    expect(bot.meta.sections).toEqual(['a'])
  })

  it('writes every other client field, drops data URLs and dead pointers, deletes cleared fields', () => {
    expect(mergedMeta(bot.meta, { title: undefined, color: '#abcdef' })).toEqual({ color: '#abcdef', face: 3, sections: ['a'] })
  })

  it('patches only what changed', () => {
    const draft = draftFor(bot)
    expect(metaPatch(bot, draft)).toEqual({})
    expect(metaPatch(bot, { ...draft, title: '  ' })).toEqual({ title: undefined })
    expect(metaPatch(bot, { ...draft, face: 5, color: faceHex(starterFace(5)) })).toEqual({ face: 5, color: faceHex(starterFace(5)), custom: true })
  })

  it('tells a Category-only change from one that touches the look (hermes-conduit#3433)', () => {
    expect(categoryOnlyPatch({ sectionId: 'home', sectionName: 'Home' })).toBe(true)
    expect(categoryOnlyPatch({ sectionId: undefined, sectionName: undefined })).toBe(true)
    expect(categoryOnlyPatch({ sectionName: 'Home', title: 'Furina' })).toBe(false)
    expect(categoryOnlyPatch({})).toBe(false)
  })

  it("writes a face's color as the phone does", () => {
    expect(faceHex(starterFace(0))).toMatch(/^#[0-9a-f]{6}$/)
    // Gray sits darker: hsl(215 18% 50%).
    expect(faceHex(starterFace(11))).toBe('#697c96')
  })

  it("reads the configure answer's look and sections", () => {
    expect(metaOutcome({ applied: { ui_meta: true } })).toBe('persisted')
    expect(metaOutcome({ applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { actual: 8 } } } })).toBe('conflict')
    expect(metaOutcome({ applied: { ui_meta: false } })).toBe('failed')
    expect(metaOutcome({ ok: true })).toBe('unsupported')
    expect(failedSections({ applied: { soul: false, description: true } }, ['soul', 'description'])).toEqual(['soul'])
  })

  it('reads the editor snapshot, with a missing enabled as on', () => {
    const details = parseDetails({
      description: 'd',
      soul: 's',
      model: { provider: 'openrouter', default: 'x/y' },
      skills: [{ name: 'a' }, { name: 'b', enabled: false }, { name: 'a' }],
      toolsets: [{ name: 'web', label: 'Web', enabled: true }],
      mcp_servers: []
    })
    expect(details).toMatchObject({ description: 'd', soul: 's', provider: 'openrouter', model: 'x/y' })
    expect(details.capabilities.skills.map(c => [c.name, c.enabled])).toEqual([
      ['a', true],
      ['b', false]
    ])
  })

  it('sends only the lists that changed; every toolset on is none; the last toolset stays on', () => {
    const original = parseDetails({
      skills: [{ name: 'a' }, { name: 'b' }],
      toolsets: [{ name: 'web' }, { name: 'shell', enabled: false }],
      mcp_servers: [{ name: 'gh' }]
    }).capabilities
    expect(capabilityParams(original, original)).toEqual({})
    let edited = setCapability(original, 'skills', 'b', false)
    expect(capabilityParams(original, edited)).toEqual({ disabled_skills: ['b'] })
    edited = setCapability(original, 'toolsets', 'shell', true)
    expect(capabilityParams(original, edited)).toEqual({ enabled_toolsets: [] })
    expect(setCapability(original, 'toolsets', 'web', false)).toBe(original)
    edited = setCapability(original, 'mcpServers', 'gh', false)
    expect(capabilityParams(original, edited)).toEqual({ enabled_mcp_servers: [] })
  })
})
