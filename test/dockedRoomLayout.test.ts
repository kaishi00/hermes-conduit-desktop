import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8')

/** Every declaration block for `selector`, joined. */
function rules(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/\s+/g, '\\s*')
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))].map(m => m[1]).join(';')
}

describe('docked group chat layout', () => {
  // Another dashboard's group chat docked in place lays the room out in a column under its note.
  // A column's item grows to its content unless told otherwise, so the room took its whole transcript's
  // height and pushed the composer out of the window (Eric, 2026-11-22: no composer in Archons).
  it('keeps the room inside the page, so its transcript scrolls and the composer stays at the bottom', () => {
    expect(rules('.docked-room-page')).toMatch(/flex-direction:\s*column/)
    expect(rules('.docked-room-page > .chat')).toMatch(/min-height:\s*0/)
  })
})
