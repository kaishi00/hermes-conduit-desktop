import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { pageAt, safeColor, splitPages, startsPage, withPagesSaid, withoutTags } from '../src/renderer/src/state/htmlInReplies'
import { copyableReply } from '../src/renderer/src/state/quote'
import { namingFiles, splitReply } from '../src/renderer/src/state/media'
import { spokenText } from '../src/renderer/src/state/voice'
import { plainLine, previewText } from '../src/renderer/src/state/text'

// The component through a path tsc doesn't follow, as botsHomeRender's: the tests' tsconfig has no JSX.
let Markdown: (props: { text: string }) => unknown
beforeAll(async () => {
  const path = '../src/renderer/src/components/Markdown'
  Markdown = ((await import(/* @vite-ignore */ path)) as { Markdown: typeof Markdown }).Markdown
})

const draw = (text: string) => renderToStaticMarkup(createElement(Markdown as never, { text }))

describe('pages written in a reply', () => {
  it('starts at a page tag at a line’s start, never at a text tag or prose', () => {
    expect(startsPage('<div class="chart">')).toBe(true)
    expect(startsPage('   <table>')).toBe(true)
    expect(startsPage('<!DOCTYPE html>')).toBe(true)
    expect(startsPage('<svg viewBox="0 0 10 10">')).toBe(true)
    expect(startsPage('<details>')).toBe(false)
    expect(startsPage('<span style="color:red">x</span>')).toBe(false)
    expect(startsPage('<Conversation>')).toBe(false)
    expect(startsPage('Use a <div> here')).toBe(false)
    expect(startsPage('    <div>')).toBe(false)
    expect(startsPage('<divider>')).toBe(false)
  })

  it('runs to where its elements close, blank lines and all', () => {
    const lines = ['Before', '<div>', '  <p>One</p>', '', '  <p>Two</p>', '</div>', 'After'].slice(1)
    expect(pageAt(lines, 0)).toEqual({ start: 0, end: 5, complete: true })
  })

  it('takes in the page tags that follow it, as one page', () => {
    const text = '<style>.a{color:red}</style>\n\n<div class="a">Hi</div>\n<script>if (1 < 2) document.title = "</div>"</script>\nDone.'
    expect(splitPages(text)).toEqual([
      { kind: 'page', html: '<style>.a{color:red}</style>\n\n<div class="a">Hi</div>\n<script>if (1 < 2) document.title = "</div>"</script>', complete: true },
      { kind: 'text', text: 'Done.' }
    ])
  })

  it('is incomplete while an element is open, a tag is cut or nothing follows it yet', () => {
    expect(splitPages('Here:\n<div>\n<p>One')).toEqual([
      { kind: 'text', text: 'Here:' },
      { kind: 'page', html: '<div>\n<p>One', complete: false }
    ])
    expect(splitPages('<div>Hi</div>\n<scr')[0]).toEqual({ kind: 'page', html: '<div>Hi</div>', complete: false })
    expect(splitPages('<div>Hi</div>\n')[0]).toEqual({ kind: 'page', html: '<div>Hi</div>', complete: false })
    expect(splitPages('<div><!-- note')[0]).toMatchObject({ complete: false })
    expect(splitPages('<script>let a = 1')[0]).toMatchObject({ complete: false })
  })

  it('closes an element left open inside one that closes, as a browser does', () => {
    expect(splitPages('<div><p>One<p>Two</div>\nAfter')[0]).toEqual({ kind: 'page', html: '<div><p>One<p>Two</div>', complete: true })
  })

  it('keeps going when the line that closes one element opens another', () => {
    expect(splitPages('<div>A</div><div>\nB\n</div>\nAfter')).toEqual([
      { kind: 'page', html: '<div>A</div><div>\nB\n</div>', complete: true },
      { kind: 'text', text: 'After' }
    ])
  })

  it('leaves a table row that starts with a tag to the table', () => {
    const table = 'Tag | Meaning\n--- | ---\n<div> | container\n\nNext steps'
    expect(splitPages(table)).toEqual([{ kind: 'text', text: table }])
    expect(splitReply(table)).toEqual([{ kind: 'markdown', text: table }])
    const header = 'Results:\n<div> | A\n--- | ---\n1 | 2'
    expect(splitPages(header)).toEqual([{ kind: 'text', text: header }])
  })

  it('is one line for a void element', () => {
    expect(splitPages('<img src="https://example.com/a.png">\nA picture.')[0]).toEqual({
      kind: 'page',
      html: '<img src="https://example.com/a.png">',
      complete: true
    })
  })

  it('keeps a fenced html block as code', () => {
    const text = '```html\n<div>Hi</div>\n```'
    expect(splitPages(text)).toEqual([{ kind: 'text', text }])
    expect(splitReply(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('is a page block in the reply, between its Markdown', () => {
    expect(splitReply('Failures jumped:\n<table><tr><td>Thu</td><td>9</td></tr></table>\nThat’s #3326.')).toEqual([
      { kind: 'markdown', text: 'Failures jumped:' },
      { kind: 'page', html: '<table><tr><td>Thu</td><td>9</td></tr></table>', complete: true },
      { kind: 'markdown', text: 'That’s #3326.' }
    ])
  })

  it('is said to be a page by speech, live models, notifications and the chat list; Copy keeps it', () => {
    const reply = 'Here:\n<div><script>chart()</script>Sales</div>\nDone.'
    expect(spokenText(reply)).not.toContain('chart')
    expect(spokenText(reply)).toContain('page')
    expect(namingFiles(reply)).toBe('Here:\n(a page in the chat)\nDone.')
    expect(plainLine(reply)).toBe('Here: 🗂 Page Done.')
    expect(previewText(reply)).toBe('Here: 🗂 Page Done.')
    expect(copyableReply(reply)).toBe('Here:\n\n<div><script>chart()</script>Sales</div>\n\nDone.')
    expect(withPagesSaid('No page here', 'x')).toBe('No page here')
  })
})

describe('text tags in a reply', () => {
  it('draws bold, italics, marks, keys, sub and superscript', () => {
    const html = draw('A <b>bold</b> <i>idea</i>, <mark>marked</mark>, <kbd>Ctrl</kbd>, H<sub>2</sub>O and x<sup>2</sup>.')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>idea</em>')
    expect(html).toContain('<mark class="reply-highlight">marked</mark>')
    expect(html).toContain('<kbd class="reply-key">Ctrl</kbd>')
    expect(html).toContain('H<sub>2</sub>O')
    expect(html).toContain('x<sup>2</sup>')
  })

  it('colors a span by its style, only with a safe color, and nothing else of the style', () => {
    expect(draw('Build is <span style="color:#e5484d; font-size: 90px">failing</span>.')).toContain('<span style="color:#e5484d">failing</span>')
    expect(draw('<font color="green">ok</font>')).toContain('<span style="color:green">ok</span>')
    expect(draw('<span style="color:url(javascript:x)">x</span>')).toContain('<span>x</span>')
    expect(draw('<span style="background-color: yellow">hi</span>')).toContain('<span style="background-color:yellow">hi</span>')
  })

  it('breaks a line at <br>', () => {
    expect(draw('One<br>Two')).toBe('<p>One<br/>\nTwo</p>')
  })

  it('keeps any other tag, or one that isn’t closed, as text', () => {
    expect(draw('Use a <video> tag')).toContain('&lt;video&gt;')
    expect(draw('An <b>unclosed tag')).toContain('&lt;b&gt;')
    expect(draw('<span onclick="x()">hi</span>')).not.toContain('onclick=')
  })

  it('never draws a tag inside code', () => {
    expect(draw('`<b>x</b>`')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('folds a <details> with its summary, the Markdown inside drawn', () => {
    const html = draw('<details>\n<summary>Full log</summary>\n\n```\nFAIL test_upload\n```\n</details>\n\nAfter.')
    expect(html).toMatch(/^<details class="reply-fold"><summary>Full log<\/summary><div class="code-block">[\s\S]*FAIL test_upload[\s\S]*<\/details>\n<p>After.<\/p>$/)
  })

  it('folds a summary written as its own paragraph, and opens one marked open', () => {
    expect(draw('<details open>\n\n<summary>Why</summary>\n\nBecause.\n\n</details>')).toBe('<details class="reply-fold" open=""><summary>Why</summary><p>Because.</p></details>')
  })

  it('folds what’s written so far while the </details> hasn’t come', () => {
    expect(draw('<details>\n<summary>Log</summary>\n\nline 1')).toBe('<details class="reply-fold"><summary>Log</summary><p>line 1</p></details>')
  })

  it('folds a <details> written without blank lines, attributes and all', () => {
    expect(draw('<details>\n<summary>Log</summary>\nline 1\n</details>\nAfter.')).toBe('<details class="reply-fold"><summary>Log</summary><p>line 1</p></details>\n<p>After.</p>')
    expect(draw('<details class="x" open>\n<summary>Why</summary>\nBecause.\n</details>')).toBe('<details class="reply-fold" open=""><summary>Why</summary><p>Because.</p></details>')
  })

  it('folds a <details> written on one line', () => {
    expect(draw('<details><summary>S</summary>The body.</details>\n\nAfter.')).toBe('<details class="reply-fold"><summary>S</summary><p>The body.</p></details>\n<p>After.</p>')
  })

  it('leaves prose that starts with <details> as prose, the rest of the reply unfolded', () => {
    const html = draw('<details> and <summary> make a fold.\n\nAfter.')
    expect(html).not.toContain('reply-fold')
    expect(html).toContain('<p>After.</p>')
    expect(draw('<details> is the tag.\n\nAfter.')).not.toContain('reply-fold')
  })

  it('leaves prose starting with <details> as prose when the closing tags after it are other folds’ or in code', () => {
    const html = draw('<details> makes a section.\n\n<details>\n<summary>S</summary>\nbody\n</details>')
    expect(html.startsWith('&lt;details&gt; makes a section.')).toBe(true)
    expect(html).toContain('<details class="reply-fold"><summary>S</summary><p>body</p></details>')
    expect(draw('<details> makes a section.\n\n```\n</details>\n```')).not.toContain('reply-fold')
    expect(draw('<details> makes a section.\n\nWrap it with `</details>` to close.')).not.toContain('reply-fold')
    expect(draw('<details> makes a section.\n\nWrap it in ``</details>`` to close.')).not.toContain('reply-fold')
    expect(draw('<details> is the opener tag.\nClose it with </details> later.')).not.toContain('reply-fold')
  })

  it('folds a body with tags after its own summary when </details> comes on a later line', () => {
    expect(draw('<details><summary>S</summary>Click <b>here</b>\nmore\n</details>')).toContain('<details class="reply-fold"><summary>S</summary>')
    expect(draw('<details><summary>S</summary>Body\nmore')).toContain('<details class="reply-fold"><summary>S</summary>')
    expect(draw('<details><summary>S</summary>Body so far\n')).toContain('<details class="reply-fold"><summary>S</summary>')
    expect(draw('<details><summary>Results</summary>42 passed</details> Ask me anything!\n\nNext.')).not.toContain('reply-fold')
    expect(draw('<details> Tap for details.\nThe details.\n</details> <!-- keep -->\n\nMore prose.')).not.toContain('reply-fold')
    expect(draw('<details title="</summary>"> Click <b>here</b>\n</details>')).not.toContain('reply-fold')
  })

  it('reads a close with a code span after it, or one inside a code span, the same in both passes (hermes-conduit#3349)', () => {
    const shown = draw('<details> Tap for details.\nThe details.\n</details> `note`\n\nMore prose.')
    expect(shown).not.toContain('reply-fold')
    expect(shown).toContain('More prose.')
    expect(draw('<details><summary>S</summary>Wrap it in `</details>` to close.\nMore.\n</details>')).toContain('<details class="reply-fold"><summary>S</summary>')
  })

  it('folds a one-line fold while its </details> is still being written', () => {
    expect(draw('<details><summary>S</summary>Body so far')).toBe('<details class="reply-fold"><summary>S</summary><p>Body so far</p></details>')
    expect(draw('<details><summary>S</summary>Click <b>here</b>')).toContain('<details class="reply-fold"><summary>S</summary>')
    expect(draw('After.\n\n<details> is the tag.')).not.toContain('reply-fold')
  })

  it('folds a compact fold whose body has an arrow in it', () => {
    expect(draw('<details><summary>Flow</summary>input -> parse\nthen render\n</details>')).toContain('<details class="reply-fold"><summary>Flow</summary>')
  })

  it('reads open only as an attribute, never inside a quoted value', () => {
    expect(draw('<details title="open me">\n<summary>S</summary>\nBody\n</details>')).toBe('<details class="reply-fold"><summary>S</summary><p>Body</p></details>')
    expect(draw('<details data-x="a>b"><summary>S</summary>Body</details>')).toBe('<details class="reply-fold"><summary>S</summary><p>Body</p></details>')
  })

  it('leaves a one-line fold whose body starts with a fence as written', () => {
    expect(draw('<details><summary>S</summary>```code```</details>\n\nAfter.')).not.toContain('reply-fold')
  })

  it('says a page inside a one-line fold as a page', () => {
    expect(withPagesSaid('<details><summary>S</summary><div>A</div></details>', 'Page')).not.toContain('<div>')
  })

  it('carries a page on only at a page element right after it', () => {
    expect(splitPages('<div>x</div> Use <div> to wrap.\nMore prose')[0]).toEqual({ kind: 'page', html: '<div>x</div> Use <div> to wrap.', complete: true })
    expect(pageAt(['<div>a</div> <div>b', '</div>', 'After'], 0).end).toBe(2)
  })

  it('takes off only the tags that pair up, as the chat draws only those', () => {
    expect(withoutTags('An <b>unclosed tag')).toBe('An <b>unclosed tag')
    expect(withoutTags('click <span hidden>secret</span> now')).toBe('click secret now')
  })

  it('ends a page at prose after its closing tag, even prose with a tag in it', () => {
    expect(splitPages('<div>x</div> as <code>y</code> shows\nAfter')[0]).toEqual({ kind: 'page', html: '<div>x</div> as <code>y</code> shows', complete: true })
    expect(splitPages('<div>x</div> as <code>y</code>\n<p>z</p>\nAfter')).toHaveLength(2)
  })

  it('takes tags off a plain line', () => {
    expect(withoutTags('a <b>b</b><br/>c')).toBe('a b c')
    expect(withoutTags('mail <me@example.com>')).toBe('mail <me@example.com>')
    expect(withoutTags('a <video> tag and Vec<String>')).toBe('a <video> tag and Vec<String>')
    expect(withoutTags('if a <b and y > z')).toBe('if a <b and y > z')
  })

  it('takes only colors a reply may use', () => {
    expect(safeColor(' Red ')).toBe('red')
    expect(safeColor('#E5484D')).toBe('#e5484d')
    expect(safeColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)')
    expect(safeColor('expression(alert(1))')).toBeNull()
    expect(safeColor('var(--x)')).toBeNull()
    expect(safeColor('hsl(10, 20%, 30%)')).toBeNull()
  })
})
