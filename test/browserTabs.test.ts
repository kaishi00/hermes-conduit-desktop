import { beforeEach, describe, expect, it } from 'vitest'
import { hostPageParts, hostPageUrl, localLink, readAddress, shownAddress } from '../src/shared/browserAddress'
import { PageCookies, answerHeaders, bodiless, browserFrameStays, browserGoes, errorPage, hostPageRequest, namesThisComputer, pageHeaderPairs, pageStatus } from '../src/main/hostPageRules'
import { MAX_PAGES, readPages, writePages, type BenchPage } from '../src/renderer/src/state/workbench'
import { addressFor, addressHere } from '../src/renderer/src/state/browserTabs'

const KEY = 'a1b2c3d4e5f6'
const ORIGIN = `conduit-host-page://5173.${KEY}`
const LOCAL = 'http://localhost:5173'

describe('Browser tab addresses (desktop issue 451)', () => {
  it('reads a port or a localhost address as the host, anything else as the web', () => {
    expect(readAddress('5173')).toEqual({ kind: 'host', port: 5173, path: '/' })
    expect(readAddress(':3000/admin?x=1')).toEqual({ kind: 'host', port: 3000, path: '/admin?x=1' })
    expect(readAddress('localhost:8080/a#b')).toEqual({ kind: 'host', port: 8080, path: '/a#b' })
    expect(readAddress('http://127.0.0.1:4321')).toEqual({ kind: 'host', port: 4321, path: '/' })
    expect(readAddress('http://localhost')).toEqual({ kind: 'host', port: 80, path: '/' })
    expect(readAddress('[::1]:9000')).toEqual({ kind: 'host', port: 9000, path: '/' })
    expect(readAddress('127.0.0.2:3000')).toEqual({ kind: 'host', port: 3000, path: '/' })
    expect(readAddress('app.localhost:5173/a')).toEqual({ kind: 'host', port: 5173, path: '/a' })
    expect(readAddress('http://localhost.:5173')).toEqual({ kind: 'host', port: 5173, path: '/' })
    expect(readAddress('http://[::ffff:127.0.0.1]:5173')).toEqual({ kind: 'host', port: 5173, path: '/' })
    expect(readAddress('http://[::ffff:7f00:1]:5173')).toEqual({ kind: 'host', port: 5173, path: '/' })
    expect(readAddress('localhostess.com')).toEqual({ kind: 'web', url: 'https://localhostess.com/' })
    expect(readAddress('http://[::]:5173/x')).toEqual({ kind: 'host', port: 5173, path: '/x' })
    expect(readAddress('example.com/docs')).toEqual({ kind: 'web', url: 'https://example.com/docs' })
    expect(readAddress('http://example.com')).toEqual({ kind: 'web', url: 'http://example.com/' })
    expect(readAddress('192.168.1.5:8080/x')).toEqual({ kind: 'web', url: 'http://192.168.1.5:8080/x' })
    expect(readAddress('10.0.0.2')).toEqual({ kind: 'web', url: 'http://10.0.0.2/' })
    expect(readAddress('nas:5000')).toEqual({ kind: 'web', url: 'http://nas:5000/' })
    expect(readAddress('70000')).toBeNull()
    expect(readAddress('just words')).toBeNull()
    expect(readAddress('  ')).toBeNull()
  })

  it('names a host page by its port and its dashboard, and shows it as localhost', () => {
    const url = hostPageUrl(KEY, 5173, '/src/App.tsx?raw')
    expect(url).toBe(`${ORIGIN}/src/App.tsx?raw`)
    expect(hostPageParts(url)).toEqual({ port: 5173, key: KEY, path: '/src/App.tsx?raw' })
    expect(shownAddress(url)).toBe('localhost:5173/src/App.tsx?raw')
    expect(shownAddress(`${ORIGIN}/`)).toBe('localhost:5173')
    expect(shownAddress('https://example.com/')).toBe('https://example.com/')
    expect(hostPageParts('https://5173.abcd/')).toBeNull()
    expect(readAddress(url)).toEqual({ kind: 'host', port: 5173, path: '/src/App.tsx?raw' })
  })

  it('takes only http links to localhost as the host’s', () => {
    expect(localLink('http://localhost:5173/')).toEqual({ port: 5173, path: '/' })
    expect(localLink('https://example.com/')).toBeNull()
    expect(localLink('5173')).toBeNull()
    expect(localLink('http://127.0.0.2:5173/a')).toEqual({ port: 5173, path: '/a' })
    expect(localLink('http://app.localhost:5173/')).toEqual({ port: 5173, path: '/' })
  })

  it('opens an address on the dashboard on screen, or says why not', () => {
    expect(addressFor('5173', KEY, true)).toEqual({ url: `${ORIGIN}/` })
    expect(addressFor('example.com', null, false)).toEqual({ url: 'https://example.com/' })
    expect('note' in addressFor('5173', KEY, false)).toBe(true)
    expect('note' in addressFor('5173', null, true)).toBe(true)
    expect('note' in addressFor('nope', KEY, true)).toBe(true)
    // A host page saved on another dashboard opens on this one; a web page as it was.
    expect(addressHere(hostPageUrl('ffffffffffff', 5173, '/x'), KEY)).toBe(`${ORIGIN}/x`)
    expect(addressHere(hostPageUrl('ffffffffffff', 5173, '/x'), null)).toBeNull()
    expect(addressHere('https://example.com/', null)).toBe('https://example.com/')
  })
})

describe('host page requests and answers', () => {
  it('wraps the page’s headers as the dev server’s own, with its cookies from the jar', () => {
    const headers = new Headers({ Accept: 'text/html', Origin: ORIGIN, Referer: `${ORIGIN}/a?b`, Cookie: 'chromium=1', Host: 'x' })
    const pairs = pageHeaderPairs(headers, ORIGIN, LOCAL, 'sid=abc')
    expect(pairs).toContainEqual(['accept', 'text/html'])
    expect(pairs).toContainEqual(['origin', LOCAL])
    expect(pairs).toContainEqual(['referer', `${LOCAL}/a?b`])
    expect(pairs).toContainEqual(['Cookie', 'sid=abc'])
    expect(pairs.some(([name]) => name === 'host')).toBe(false)
    expect(pairs.filter(([name]) => name.toLowerCase() === 'cookie')).toHaveLength(1)
  })

  it('keeps a dev server’s cookies, and lets them expire', () => {
    let now = 1_000_000
    const jar = new PageCookies(() => now)
    jar.take('sid=abc; Path=/; HttpOnly')
    jar.take('short=1; Max-Age=10')
    jar.take('gone=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    expect(jar.header()).toBe('sid=abc; short=1')
    now += 11_000
    expect(jar.header()).toBe('sid=abc')
    jar.take('sid=; Max-Age=0')
    expect(jar.header()).toBeNull()
  })

  it('unwraps the answer: cookies to the jar, a redirect to its own origin kept on the page’s', () => {
    const jar = new PageCookies()
    const headers = answerHeaders(
      JSON.stringify([
        ['Content-Type', 'text/html'],
        ['Set-Cookie', 'sid=abc'],
        ['Location', `${LOCAL}/login?next=%2F`],
        ['Transfer-Encoding', 'chunked']
      ]),
      ORIGIN,
      LOCAL,
      jar
    )
    expect(headers.get('content-type')).toBe('text/html')
    expect(headers.get('location')).toBe(`${ORIGIN}/login?next=%2F`)
    expect(headers.has('set-cookie')).toBe(false)
    expect(headers.has('transfer-encoding')).toBe(false)
    expect(jar.header()).toBe('sid=abc')
    expect(answerHeaders(JSON.stringify([['Location', 'http://127.0.0.1:5173/x']]), ORIGIN, LOCAL, jar).get('location')).toBe(`${ORIGIN}/x`)
    expect(answerHeaders(JSON.stringify([['Location', 'https://example.com/']]), ORIGIN, LOCAL, jar).get('location')).toBe('https://example.com/')
    expect([...answerHeaders('not json', ORIGIN, LOCAL, jar).keys()]).toEqual([])
  })

  it('passes the dev server’s status on, with no body where there is none', () => {
    expect(pageStatus('404')).toBe(404)
    expect(pageStatus('101')).toBe(502)
    expect(pageStatus(null)).toBe(502)
    expect(bodiless('HEAD', 200)).toBe(true)
    expect(bodiless('GET', 304)).toBe(true)
    expect(bodiless('GET', 200)).toBe(false)
    expect(errorPage('<b>')).toContain('&#60;b&#62;')
  })
})

describe('where a Browser tab goes', () => {
  const from = `${ORIGIN}/`
  it('keeps a host page on its host, and its localhost links there', () => {
    expect(browserGoes('host', `${ORIGIN}/about`, from, false)).toBe('stay')
    expect(browserGoes('host', 'conduit-host-page://3000.ffffffffffff/', from, false)).toBe('refuse')
    expect(browserGoes('host', 'http://localhost:3000/x', from, false)).toEqual({ load: `conduit-host-page://3000.${KEY}/x` })
    expect(browserGoes('host', 'https://example.com/', from, false)).toBe('external')
    expect(browserGoes('host', 'mailto:a@b.c', from, false)).toBe('external')
    expect(browserGoes('host', 'file:///etc/passwd', from, false)).toBe('refuse')
  })

  it('sends a host page’s own requests to localhost to the host, never to this computer', () => {
    expect(hostPageRequest('http://localhost:8000/api?x=1', from)).toEqual({ redirectURL: `conduit-host-page://8000.${KEY}/api?x=1` })
    expect(hostPageRequest('http://127.0.0.2/x.png', from)).toEqual({ redirectURL: `conduit-host-page://80.${KEY}/x.png` })
    expect(hostPageRequest('ws://localhost:5173/', from)).toEqual({ cancel: true })
    expect(hostPageRequest('http://localhost:8000/', undefined)).toEqual({ cancel: true })
    expect(hostPageRequest('http://localhost:8000/', 'https://example.com/')).toEqual({ cancel: true })
    expect(hostPageRequest('https://example.com/', from)).toBeNull()
    expect(hostPageRequest(`${ORIGIN}/x`, from)).toBeNull()
  })

  it('never takes a web page to a host page or this computer’s localhost', () => {
    expect(browserGoes('web', 'https://example.com/next', 'https://example.com/', false)).toBe('stay')
    expect(browserGoes('web', `${ORIGIN}/`, 'https://example.com/', false)).toBe('refuse')
    expect(browserGoes('web', 'http://localhost:3000/', 'https://example.com/', false)).toBe('refuse')
    for (const alias of ['http://127.0.0.2:3000/', 'http://[::ffff:127.0.0.1]/', 'http://localhost.:3000/', 'http://app.localhost/', 'http://0.0.0.0:80/', 'http://[::1]:9/']) {
      expect(namesThisComputer(alias)).toBe(true)
      expect(browserGoes('web', alias, 'https://example.com/', false)).toBe('refuse')
      expect(browserFrameStays('web', alias)).toBe(false)
    }
    for (const elsewhere of ['https://example.com/', 'http://192.168.1.5/', 'http://[fe80::1]/', 'http://128.0.0.1/', 'http://localhostess.com/']) {
      expect(namesThisComputer(elsewhere)).toBe(false)
    }
    expect(browserFrameStays('web', `${ORIGIN}/`)).toBe(false)
    expect(browserFrameStays('web', 'https://youtube.com/embed/x')).toBe(true)
    expect(browserFrameStays('host', `${ORIGIN}/frame`)).toBe(true)
    expect(browserFrameStays('host', 'about:blank')).toBe(true)
    expect(browserFrameStays('host', 'http://localhost:9/')).toBe(false)
  })
})

describe('Browser tabs kept per folder', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    })
  })

  it('comes back for its folder, leaving out new tabs with no address', () => {
    const pages: BenchPage[] = [
      { id: 'a', url: `${ORIGIN}/`, title: 'Vite', nav: 3 },
      { id: 'b', url: null, nav: 0 }
    ]
    writePages('/r/one', pages)
    expect(readPages('/r/one')).toEqual([{ id: 'a', url: `${ORIGIN}/`, title: 'Vite', nav: 0 }])
    expect(readPages('/r/two')).toEqual([])
    writePages('/r/one', [])
    expect(readPages('/r/one')).toEqual([])
    const many = Array.from({ length: MAX_PAGES + 3 }, (_, i) => ({ id: String(i), url: `https://e${i}.com/`, nav: 0 }))
    writePages('/r/one', many)
    expect(readPages('/r/one')).toHaveLength(MAX_PAGES)
    store.set('conduit.benchPages', 'nope')
    expect(readPages('/r/one')).toEqual([])
  })
})
