import { describe, expect, it } from 'vitest'
import { linkUrl, linkUrlFromArgs, newChatLink, NEW_CHAT_TITLE_MAX } from '../src/shared/linkUrls'

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
  })

  it('refuses an odd profile or path, and cuts a long title', () => {
    expect(newChatLink('conduit://new?profile=a%20b')).toBeNull()
    expect(newChatLink('conduit://new/extra?text=hi')).toBeNull()
    expect(linkUrl('conduit://newer?text=hi')).toBeNull()
    expect(newChatLink(`conduit://new?title=${'t'.repeat(200)}`)?.title).toHaveLength(NEW_CHAT_TITLE_MAX)
  })
})
