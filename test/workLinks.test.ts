import { describe, expect, it } from 'vitest'
import { landsWithBots, linkNamedRefs, linkSessionRefs, sessionInLink, splitWorkLinks } from '../src/renderer/src/state/workLinks'

const W19 = 'conduit://session/20261120_165155_a24bea?profile=zhongli'

describe('work links', () => {
  it('lifts a work link and its own @session reference out of the reply', () => {
    const text = `PR #14 is merged and deployed. Open W19 [Open W19](${W19}) @session:zhongli/20261120_165155_a24bea`
    const split = splitWorkLinks(text.replace('Open W19 [', '['))
    expect(split).toEqual({
      text: 'PR #14 is merged and deployed.',
      links: [{ ref: 'W19', sessionId: '20261120_165155_a24bea', profile: 'zhongli' }]
    })
  })

  it('keeps a reference to another session, and the parentheses around a lone link go', () => {
    const split = splitWorkLinks(`Started it (see [W7: Provision the LXC](${W19})). Earlier: @session:zhongli/other_1.`)
    expect(split?.links.map(l => l.ref)).toEqual(['W7'])
    expect(split?.text).toBe('Started it (see). Earlier: @session:zhongli/other_1.')
    expect(splitWorkLinks(`Done ([Open W3](${W19})).`)?.text).toBe('Done.')
  })

  it('lists each workstream once, and leaves a reply without work links alone', () => {
    expect(splitWorkLinks(`[Open W2](${W19}) and again [W2 — fix](${W19})`)?.links).toHaveLength(1)
    expect(splitWorkLinks('No links [here](https://example.com)')).toBeNull()
  })

  it('leaves a work link quoted in code as written', () => {
    const quoted = `The plugin writes \`[Open W3](${W19}) @session:zhongli/20261120_165155_a24bea\` for each.`
    expect(splitWorkLinks(quoted)).toBeNull()
    const fenced = `Like this:\n\n\`\`\`\n[Open W3](${W19})\n\`\`\`\n\nand [Open W4](${W19})`
    expect(splitWorkLinks(fenced)).toEqual({ text: `Like this:\n\n\`\`\`\n[Open W3](${W19})\n\`\`\`\n\nand`, links: [{ ref: 'W4', sessionId: '20261120_165155_a24bea', profile: 'zhongli' }] })
  })

  it('takes a fence only at a line’s start', () => {
    const text = `Use \`\`\`lang to open a fence.\n\n[Open W19](${W19}) @session:zhongli/20261120_165155_a24bea`
    expect(splitWorkLinks(text)?.text).toBe('Use ```lang to open a fence.')
  })

  it('closes a span only with a run as long as the one that opened it', () => {
    const quoted = `See \`\`a \` [Open W19](${W19}) b\`\` for the format.`
    expect(splitWorkLinks(quoted)?.links ?? []).toEqual([])
    const open = `A stray \` here.\n\n[Open W19](${W19})`
    expect(splitWorkLinks(open)?.links.length).toBe(1)
  })

  it('reads fences as the phone does', () => {
    const link = '[Open W3](conduit://session/c)'
    expect(splitWorkLinks(`~~~\n${link}\n~~~`)?.links ?? []).toEqual([])
    expect(splitWorkLinks(`\`\`\`\`\n\`\`\`\n${link}\n\`\`\`\n\`\`\`\``)?.links ?? []).toEqual([])
    expect(splitWorkLinks(`\`\`\`\n\`\`\` not a closer\n${link}\n\`\`\``)?.links ?? []).toEqual([])
    expect(splitWorkLinks(`> \`\`\`\n> ${link}\n> \`\`\``)?.links ?? []).toEqual([])
    expect(splitWorkLinks('Done: [W7: fix the `nil` crash](conduit://session/w7).')?.links.map(l => l.ref)).toEqual(['W7'])
  })

  it('keeps a quoted reference after a link in prose, and a CRLF blank line ends a span', () => {
    const quoted = splitWorkLinks('[Open W3](conduit://session/c) `@session:p/c` more')
    expect(quoted?.text).toBe('`@session:p/c` more')
    expect(quoted?.links.map(l => l.ref)).toEqual(['W3'])
    expect(splitWorkLinks('Done: [W7: fix the `nil` crash](conduit://session/w7) @session:p/w7.')?.text).toBe('Done:.')
    // A span opening in the link's title and closing after the reference quotes it: it stays as written.
    expect(splitWorkLinks('Done: [W7: `note](conduit://session/w7) @session:p/w7`')).toEqual({ text: 'Done: @session:p/w7`', links: [{ ref: 'W7', sessionId: 'w7' }] })
    expect(splitWorkLinks('`note\r\n\r\n[Open W3](conduit://session/c)`')?.links.map(l => l.ref)).toEqual(['W3'])
  })

  it('reads the id and profile of a chat link', () => {
    expect(sessionInLink(W19)).toEqual({ sessionId: '20261120_165155_a24bea', profile: 'zhongli' })
    expect(sessionInLink('conduit://session/abc')).toEqual({ sessionId: 'abc', profile: undefined })
    expect(sessionInLink('https://example.com')).toBeNull()
    expect(sessionInLink('conduit://session/abc.')).toEqual({ sessionId: 'abc', profile: undefined })
  })
})

describe('references to chats', () => {
  const titles: Record<string, string> = { s1: 'Plan the trip' }
  const titleOf = (id: string) => titles[id]

  it('links a reference with the chat’s name, or Open chat', () => {
    expect(linkSessionRefs('See @session:hermes/s1. Or @session:s2', titleOf, 'Open chat')).toBe(
      'See [Plan the trip](conduit://session/s1?profile=hermes). Or [Open chat](conduit://session/s2)'
    )
  })

  it('makes a reference used as a link’s address a chat link, and leaves code and words in links alone', () => {
    expect(linkSessionRefs('[that chat](@session:hermes/s1)', titleOf, 'Open chat')).toBe('[that chat](conduit://session/s1?profile=hermes)')
    expect(linkSessionRefs('`@session:hermes/s1`', titleOf, 'Open chat')).toBe('`@session:hermes/s1`')
    expect(linkSessionRefs('``a @session:hermes/s1 b``', titleOf, 'Open chat')).toBe('``a @session:hermes/s1 b``')
    expect(linkSessionRefs('~~~\n@session:hermes/s1\n~~~', titleOf, 'Open chat')).toBe('~~~\n@session:hermes/s1\n~~~')
    // A sentence's full stop isn't part of the id.
    expect(linkSessionRefs('[that chat](@session:hermes/s1.)', titleOf, 'Open chat')).toBe('[that chat](conduit://session/s1?profile=hermes)')
    expect(linkSessionRefs('mail me@session:x', titleOf, 'Open chat')).toBe('mail me@session:x')
  })
})

describe('named refs in a Bot Chat reply', () => {
  const chatOf = (ref: string) => (ref === 'W50' ? { sessionId: 's50', profile: 'zhongli' } : undefined)

  it('links a ref the work lists, and leaves others, links and code as written', () => {
    expect(linkNamedRefs('W50 found it; W51 is new.', chatOf)).toBe('[W50](conduit://session/s50?profile=zhongli) found it; W51 is new.')
    expect(linkNamedRefs('[W50](https://x) and `W50` and W50.txt', chatOf)).toBe('[W50](https://x) and `W50` and W50.txt')
  })
})

describe("a chat window's request to open a chat in the main window (#428)", () => {
  it('lands a workstream beside the bots on the window\'s word, before the cross-bot read lists it', () => {
    expect(landsWithBots({ storedId: 's1', workstream: true }, new Set())).toBe(true)
    expect(landsWithBots({ storedId: 's1' }, new Set(['s1']))).toBe(true)
    // An ordinary chat keeps the list it was opened from.
    expect(landsWithBots({ storedId: 's1' }, new Set(['s2']))).toBe(false)
    expect(landsWithBots({ storedId: 's1', workstream: false }, new Set())).toBe(false)
  })
})
