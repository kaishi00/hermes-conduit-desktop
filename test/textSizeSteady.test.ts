import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments stripped, so a commented-out rule doesn't count.
const css = ['app.css', 'theme.css']
  .map(name => readFileSync(join(__dirname, '../src/renderer/src/styles', name), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('text size and pane width', () => {
  // The chat stepped its text up as its pane widened, so closing the sidebar or a side panel changed
  // the font size (a reader on Reddit, 2026-11-25). Text size follows the Chat text size setting alone.
  it('zooms only by the Chat text size setting', () => {
    const zooms = [...css.matchAll(/(?:^|[;{\s])zoom\s*:\s*([^;}]+)/g)].map(m => m[1].trim())
    expect(zooms).toEqual(['var(--chat-scale, 1)'])
  })

  it('sets no font size from a width', () => {
    const sizes = [...css.matchAll(/font(?:-size)?\s*:\s*([^;}]+)/g)].map(m => m[1])
    expect(sizes.filter(v => /\d(?:vw|vi|vmin|vmax|cqw|cqi|cqmin|cqmax)\b/.test(v))).toEqual([])
  })

  it('changes no font size inside a width query', () => {
    const offenders: string[] = []
    for (const m of css.matchAll(/@(?:container|media)[^{]*\b(?:width|inline-size)\b[^{]*\{/g)) {
      let depth = 1
      let i = m.index + m[0].length
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        i++
      }
      const block = css.slice(m.index, i)
      if (/font-size\s*:|(?:^|[;{\s])font\s*:/.test(block)) offenders.push(m[0].trim())
    }
    expect(offenders).toEqual([])
  })
})
