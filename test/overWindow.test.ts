import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const components = join(__dirname, '../src/renderer/src/components')

describe('views that cover the window (desktop#606)', () => {
  it('are drawn on the page, not inside the transcript that opened them', () => {
    // The transcript fades under the chat header with a mask and scales with the chat's text size: a
    // whole-window view left inside it was cut to the transcript, its video's controls under the composer.
    const covering = readdirSync(components)
      .filter(name => name.endsWith('.tsx'))
      .map(name => ({ name, source: readFileSync(join(components, name), 'utf8') }))
      .filter(file => /className="page-full\b/.test(file.source))
    expect(covering.map(file => file.name).sort()).toEqual(['FileViewer.tsx', 'PagePreview.tsx'])
    for (const file of covering) {
      expect(file.source, file.name).toMatch(/<OverWindow>\s*<div className="page-full\b/)
    }
  })

  it('portal to the document body', () => {
    const source = readFileSync(join(components, 'OverWindow.tsx'), 'utf8')
    expect(source).toMatch(/createPortal\(children, document\.body\)/)
  })
})
