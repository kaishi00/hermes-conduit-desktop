import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

// A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
const path = '../src/renderer/src/components/SettingsProfile.tsx'
type Tile = { key: string; host: string; own: boolean; bot: { name: string; title: string; hasAvatar: boolean; isDefault?: boolean } }
const tile = (host: string, name: string, own: boolean, isDefault = false): Tile => ({
  key: `${host}\u001f${name}`,
  host,
  own,
  bot: { name, title: name[0]!.toUpperCase() + name.slice(1), hasAvatar: false, isDefault }
})
const tiles = [tile('https://a', 'default', true, true), tile('https://a', 'nahida', true), tile('https://b', 'nahida', false)]

describe("Settings' profile card", () => {
  it("edits this dashboard's profile, never another dashboard's namesake, and falls back to the main profile", async () => {
    const { settingsProfileTile } = (await import(/* @vite-ignore */ path)) as { settingsProfileTile: (tiles: Tile[], profile: string) => Tile | null }
    expect(settingsProfileTile(tiles, 'Nahida')?.key).toBe('https://a\u001fnahida')
    expect(settingsProfileTile(tiles, 'gone')?.key).toBe('https://a\u001fdefault')
    expect(settingsProfileTile([tiles[2]!], 'nahida')).toBeNull()
  })

  it('names the profile and offers every profile in a dropdown with two or more', async () => {
    const { SettingsProfileCard } = (await import(/* @vite-ignore */ path)) as { SettingsProfileCard: unknown }
    const props = { profile: 'nahida', badgeFor: () => null, onPick: () => {}, onEditProfile: () => {} }
    const many = renderToStaticMarkup(createElement(SettingsProfileCard as never, { ...props, tiles }))
    expect(many).toContain('<h2>Nahida</h2>')
    expect(many).toContain('conduit-select')
    expect(many).toContain('Edit profile')
    const one = renderToStaticMarkup(createElement(SettingsProfileCard as never, { ...props, tiles: [tiles[1]] }))
    expect(one).not.toContain('conduit-select')
    expect(one).toContain('settings-profile-name')
  })
})
