import { describe, expect, it } from 'vitest'
import { isNewChatUrl, linkUrl, linkUrlFromArgs, newChatLink, NEW_CHAT_TITLE_MAX } from '../src/shared/linkUrls'

describe('Link invites from other apps', () => {
  it('finds the invite among a launch’s arguments', () => {
    expect(linkUrlFromArgs(['/Applications/Conduit', '--flag', 'conduit://link/abc123'])).toBe('conduit://link/abc123')
    expect(linkUrlFromArgs(['C:\\Conduit.exe', ' CONDUIT://link/x '])).toBe('CONDUIT://link/x')
    expect(linkUrlFromArgs(['conduit://other/abc', 'https://example.com'])).toBeNull()
    expect(linkUrl('conduit://link/')).toBeNull()
  })
})

describe('New chat links (hermes-conduit issue 3389)', () => {
  it('reads every part, all of them optional', () => {
    const url = 'conduit://new?text=Plan%20the%20trip%0Afor%20May&profile=work&title=%20Trip%20&send=1'
    expect(linkUrlFromArgs(['C:\\Conduit.exe', url])).toBe(url)
    expect(newChatLink(url)).toEqual({ text: 'Plan the trip\nfor May', profile: 'work', title: 'Trip', sends: true })
    expect(newChatLink('conduit://new')).toEqual({ text: '', sends: false })
    expect(newChatLink('CONDUIT://new/?text=hi&send=0')).toEqual({ text: 'hi', sends: false })
    expect(newChatLink('conduit://new?text=%20%20&title=&profile=')).toEqual({ text: '', sends: false })
    expect(newChatLink('conduit://new?text=hi&send=true')?.sends).toBe(false)
  })

  it('refuses an odd profile or path, and cuts a long title', () => {
    expect(newChatLink('conduit://new?profile=a%20b')).toBeNull()
    expect(newChatLink('conduit://new/extra?text=hi')).toBeNull()
    expect(linkUrl('conduit://newer?text=hi')).toBeNull()
    expect(newChatLink(`conduit://new?title=${'t'.repeat(200)}`)?.title).toHaveLength(NEW_CHAT_TITLE_MAX)
    // A cut never leaves half an emoji.
    const emoji = encodeURIComponent(`${'t'.repeat(NEW_CHAT_TITLE_MAX - 1)}😀`)
    expect(newChatLink(`conduit://new?title=${emoji}`)?.title).toBe('t'.repeat(NEW_CHAT_TITLE_MAX - 1))
  })

  it('tells a refused new chat link from an invite', () => {
    expect(isNewChatUrl('conduit://new?profile=a%20b')).toBe(true)
    expect(isNewChatUrl('conduit://new')).toBe(true)
    expect(isNewChatUrl('conduit://newer')).toBe(false)
    expect(isNewChatUrl('conduit://link/abc')).toBe(false)
  })
})
