import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import { markdownBlocks } from '../src/renderer/src/state/markdownBlocks'
import { remarkDesktopCards } from '../src/renderer/src/state/desktopCards'

const plugins = [remarkGfm, remarkBreaks, remarkDesktopCards]
const draw = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: plugins }, text))
const drawBlocks = (blocks: string[]) =>
  renderToStaticMarkup(createElement(Fragment, null, ...blocks.map((b, i) => createElement(ReactMarkdown, { key: i, remarkPlugins: plugins }, b))))
const squash = (html: string) => html.replace(/>\s+</g, '><').trim()

const replies = [
  '# Plan\n\nFirst a paragraph\nwith a break.\n\n- one\n- two\n\nThen this.',
  'Loose list:\n\n1. first\n\n2. second\n\n   more of second\n\n3. third\n\nDone.',
  'Code:\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nAfter the code.',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n> another quote\n\n---\n\nEnd',
  'Indented:\n\n    code line\n\n    more code\n\nText',
  '~~~\nfence with ``` inside\n\n~~~\n\nok',
  '- item\n\n  continued\n- next\n\nAfter',
  '``` a ` b\n```\n\ntext',
  'See [x][1].\n\n> [1]: https://example.com\n\nAfter',
  'A card:\n\n::chart{source="x" id="1"}\n\nAfter the card.'
]

describe('a streaming reply in blocks', () => {
  it('splits only where a block of its own starts', () => {
    expect(markdownBlocks('a\n\nb\n\nc')).toEqual(['a', 'b', 'c'])
    expect(markdownBlocks('```\nx\n\ny\n```\n\nz')).toEqual(['```\nx\n\ny\n```', 'z'])
    expect(markdownBlocks('1. a\n\n2. b')).toEqual(['1. a\n\n2. b'])
    expect(markdownBlocks('- a\n\n  more')).toEqual(['- a\n\n  more'])
    expect(markdownBlocks('')).toEqual([''])
  })

  it('keeps whole a reply with definitions or HTML that reach across blocks', () => {
    expect(markdownBlocks('See [x][1].\n\n[1]: https://example.com')).toHaveLength(1)
    expect(markdownBlocks('Note[^a].\n\n[^a]: footnote')).toHaveLength(1)
    expect(markdownBlocks('<!--\n\n-->\n\ntext')).toHaveLength(1)
    expect(markdownBlocks('See [x][1].\n\n> [1]: https://example.com')).toHaveLength(1)
    expect(markdownBlocks('Note[^a].\n\n- [^a]: footnote')).toHaveLength(1)
  })

  it('draws the same as one parse', () => {
    for (const reply of replies) expect(squash(drawBlocks(markdownBlocks(reply)))).toBe(squash(draw(reply)))
  })

  it('draws the same at every point of a stream', () => {
    for (const reply of replies)
      for (let n = 1; n <= reply.length; n++) {
        const part = reply.slice(0, n)
        expect(squash(drawBlocks(markdownBlocks(part)))).toBe(squash(draw(part)))
      }
  })
})
