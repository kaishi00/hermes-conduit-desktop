import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavGlyph, type NavGlyphName } from '../src/renderer/src/components/navGlyphs'

const NAMES: NavGlyphName[] = ['bots', 'chats', 'tasks', 'pulse', 'artifacts', 'needs', 'settings']

describe('NavGlyph', () => {
  it('draws every section glyph in currentColor only, with no baked-in colour', () => {
    for (const name of NAMES) {
      const html = renderToStaticMarkup(createElement(NavGlyph, { name }))
      expect(html).toContain(`data-glyph="${name}"`)
      // Fills are currentColor (the glyph) or #fff/#000 (mask keep/cut); nothing else.
      const colours = [...html.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1])
      expect(colours.every((c) => ['currentColor', '#fff', '#000', 'none'].includes(c))).toBe(true)
    }
  })

  it('gives each copy its own mask ids, so two glyphs on screen never share a mask', () => {
    const html = renderToStaticMarkup(
      createElement(Fragment, null, createElement(NavGlyph, { name: 'chats' }), createElement(NavGlyph, { name: 'chats' }))
    )
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(html).toContain(`mask="url(#${id})"`)
    }
  })

  it('keeps the back plane at half strength', () => {
    const html = renderToStaticMarkup(createElement(NavGlyph, { name: 'artifacts' }))
    expect(html).toContain('fill-opacity="0.5"')
  })
})
