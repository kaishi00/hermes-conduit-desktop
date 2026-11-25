import { describe, expect, it } from 'vitest'
import { cookieJarOf, isWebPage, pastSignIn, plainUserAgent, signInPartition } from '../src/main/browserSignInRules'

describe('the sign-in window’s rules', () => {
  it('keeps one browser session per dashboard address, apart from every other', () => {
    const one = signInPartition('https://hermes.example.com/hermes')
    expect(one).toMatch(/^persist:signin-[0-9a-f]{24}$/)
    expect(signInPartition('https://hermes.example.com')).toBe(one)
    expect(signInPartition('https://hermes.example.com:8443')).not.toBe(one)
    expect(signInPartition('http://hermes.example.com')).not.toBe(one)
    expect(signInPartition('https://other.example.com')).not.toBe(one)
  })

  it('names the browser without Electron or the app', () => {
    const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) conduit-desktop/1.0.2 Chrome/146.0.0.0 Electron/44.1.0 Safari/537.36'
    expect(plainUserAgent(agent, 'conduit-desktop')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36')
    expect(plainUserAgent(agent.replace('conduit-desktop', 'Conduit'), 'Conduit')).not.toMatch(/Conduit|Electron/)
  })

  it('reads the cookies the dashboard would be sent, the longer path first for a name set twice', () => {
    expect(cookieJarOf([
      { name: '_oauth2_proxy', value: 'a', path: '/' },
      { name: 'hermes_session', value: 'root', path: '/' },
      { name: 'hermes_session', value: 'prefixed', path: '/hermes' },
      { name: '', value: 'x' }
    ])).toEqual({ _oauth2_proxy: 'a', hermes_session: 'prefixed' })
  })

  it('tries the cookies only on the dashboard itself, past every sign-in page', () => {
    const dashboard = 'https://hermes.example.com'
    expect(pastSignIn('https://hermes.example.com/', dashboard)).toBe(true)
    expect(pastSignIn('https://hermes.example.com/chats', dashboard)).toBe(true)
    expect(pastSignIn('https://accounts.google.com/signin', dashboard)).toBe(false)
    expect(pastSignIn('https://hermes.example.com/oauth2/sign_in', dashboard)).toBe(false)
    expect(pastSignIn('https://hermes.example.com/login?next=%2F', dashboard)).toBe(false)
    expect(pastSignIn('about:blank', dashboard)).toBe(false)
    expect(pastSignIn('', dashboard)).toBe(false)
  })

  it('shows web pages only', () => {
    expect(isWebPage('https://accounts.google.com/')).toBe(true)
    expect(isWebPage('http://192.168.1.20:9119/')).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'conduit://pair', 'not a url']) expect(isWebPage(url), url).toBe(false)
  })
})
