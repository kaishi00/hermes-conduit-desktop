import { describe, expect, it } from 'vitest'
import { CHECK_WAIT_MAX_MS, checkWait, cookieJarOf, isWebPage, lookRequest, pastSignIn, plainUserAgent, signInPartition } from '../src/main/browserSignInRules'

describe('a page load during an in-flight sign-in check (issue 520)', () => {
  it('remembers the load and runs it once the check ends', () => {
    expect(lookRequest(true, true, false)).toEqual({ run: false, pending: true })
    expect(lookRequest(false, false, true)).toEqual({ run: true, pending: false })
    // A timer look while checking is not remembered as a load.
    expect(lookRequest(true, false, false)).toEqual({ run: false, pending: false })
    // A second load before the check ends stays pending once.
    expect(lookRequest(true, true, true)).toEqual({ run: false, pending: true })
  })

  it('does not keep the load the check started on to check it twice (desktop#520)', () => {
    // did-finish-load for the load whose did-navigate began the check.
    expect(lookRequest(true, true, false, true)).toEqual({ run: false, pending: false })
    // A load that came after the check began is kept.
    expect(lookRequest(true, true, false, false)).toEqual({ run: false, pending: true })
    // Out of a check, a load always runs.
    expect(lookRequest(false, true, false, true)).toEqual({ run: true, pending: false })
  })
})

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

describe('a dashboard that keeps failing the sign-in window’s check (desktop#511)', () => {
  it('is asked at the usual pace a few times, then less and less often, up to half a minute', () => {
    expect([1, 2].map(failures => checkWait(failures, 1_500))).toEqual([0, 0])
    expect([3, 4, 5].map(failures => checkWait(failures, 1_500))).toEqual([3_000, 6_000, 12_000])
    expect(checkWait(40, 1_500)).toBe(CHECK_WAIT_MAX_MS)
  })
})
