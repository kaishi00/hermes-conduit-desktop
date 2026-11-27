import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

let Markdown: (props: { text: string }) => unknown
beforeAll(async () => {
  const path = '../src/renderer/src/components/Markdown'
  Markdown = ((await import(/* @vite-ignore */ path)) as { Markdown: typeof Markdown }).Markdown
})

const draw = (text: string) => renderToStaticMarkup(createElement(Markdown as never, { text }))

describe('a Markdown picture in a reply', () => {
  it('draws as a reply picture that opens larger, not a bare image at its own width', () => {
    const html = draw('Verified end-to-end just now:\n\n![A seedling](https://example.com/plant.png)')
    expect(html).toContain('class="picture-button reply-picture"')
    expect(html).toContain('<img src="https://example.com/plant.png" alt="A seedling"/>')
  })

  it('is named Image when it has no description', () => {
    expect(draw('![](https://example.com/plant.png)')).toContain('alt="Image"')
  })

  it('keeps its description as text when its address is refused', () => {
    const html = draw('![A seedling](javascript:alert(1))')
    expect(html).not.toContain('<img')
    expect(html).toContain('A seedling')
  })

  it('never draws wider than its column', () => {
    const css = readFileSync(new URL('../src/renderer/src/styles/app.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.picture-button \{[^}]*max-width: 100%;/)
    expect(css).toMatch(/\.reply-picture img \{[^}]*max-width: min\(420px, 100%\);[^}]*max-height: 360px;/)
  })
})
