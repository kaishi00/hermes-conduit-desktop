import { describe, expect, it } from 'vitest'
import { firstListed, folderStart, HOST_HOME, listedFolder, newChatProjects, projectFor } from '../src/renderer/src/state/projectFolders'
import type { Project } from '../src/renderer/src/state/projects'
import { forgetResolvedHosts, hostSpellings, isThisComputer, resolveHost } from '../src/main/localFolders'

const project = (id: string, path?: string, isHome = false): Project => ({ id, title: id, path, isHome, isAuto: false, count: 0, previews: [] })

describe('a project’s folder from this computer (desktop#605)', () => {
  const names: Record<string, string[]> = {
    'ruans-macbook.tail1234.ts.net': ['100.101.102.103'],
    'hermes.home.arpa': ['fd7a:115c:a1e0::1%utun4'],
    'loop.example.com': ['127.0.0.1'],
    'hermes.example.com': ['203.0.113.7'],
    'ruans-macbook.example.com': ['203.0.113.8']
  }
  const asked: string[] = []
  const deps = {
    hostname: () => 'Ruans-MacBook',
    addresses: () => ['127.0.0.1', '192.168.1.20', 'fe80::1', '::1', '100.101.102.103', 'fd7a:115c:a1e0::1'],
    resolve: async (host: string) => {
      asked.push(host)
      if (host === 'slow.example.com') throw new Error('ENOTFOUND')
      return names[host] ?? []
    }
  }

  it('counts loopback, this computer’s name and its own addresses as this computer', async () => {
    for (const url of ['http://localhost:9119', 'http://127.0.0.1:9119', 'http://[::1]:9119', 'http://ruans-macbook.local:9119', 'http://Ruans-MacBook:9119', 'http://192.168.1.20:9119', 'http://100.101.102.103:9119'])
      expect(await isThisComputer(url, deps), url).toBe(true)
  })

  it('counts a name that resolves back here, such as a Tailscale name, as this computer (desktop issue 763)', async () => {
    for (const url of ['https://ruans-macbook.tail1234.ts.net', 'http://hermes.home.arpa:9119', 'http://loop.example.com:9119'])
      expect(await isThisComputer(url, deps), url).toBe(true)
  })

  it('counts any other host, a name that doesn’t resolve, a missing address and a broken one as elsewhere', async () => {
    for (const url of ['http://192.168.1.21:9119', 'https://hermes.example.com', 'http://ruans-macbook.example.com', 'http://slow.example.com', undefined, 'not a url'])
      expect(await isThisComputer(url, deps), String(url)).toBe(false)
  })

  it('looks up names only, never an address', async () => {
    asked.length = 0
    await isThisComputer('http://192.168.1.21:9119', deps)
    await isThisComputer('http://[fe80::2]:9119', deps)
    expect(asked).toEqual([])
  })

  it('keeps only the system’s answer: a lookup past the wait counts as elsewhere this time and its late answer serves the next ask', async () => {
    forgetResolvedHosts()
    let answer: (addresses: string[]) => void = () => {}
    let asks = 0
    const slow = () => {
      asks++
      return new Promise<string[]>(done => (answer = done))
    }
    expect(await resolveHost('mac.tail1234.ts.net', { lookup: slow, waitMs: 5 })).toEqual([])
    answer(['100.101.102.103'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await resolveHost('mac.tail1234.ts.net', { lookup: slow, waitMs: 5 })).toEqual(['100.101.102.103'])
    expect(asks).toBe(1)
    const missing = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await resolveHost('gone.example.com', { lookup: missing, waitMs: 5 })).toEqual([])
    expect(await resolveHost('gone.example.com', { lookup: slow, waitMs: 5 })).toEqual([])
    expect(asks).toBe(1)
    forgetResolvedHosts()
  })

  it('opens the host’s folders at its home folder when nothing else names one, and shows that folder’s path once listed (desktop issue 763)', () => {
    expect(folderStart(undefined, [])).toBe(HOST_HOME)
    expect(folderStart(undefined, null)).toBe(HOST_HOME)
    expect(folderStart('  ', [project('Loose')])).toBe(HOST_HOME)
    const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
    expect(listedFolder(HOST_HOME, ['/Users/ruan/Desktop', '/Users/ruan/dev'], parent)).toBe('/Users/ruan')
    expect(listedFolder(HOST_HOME, [], parent)).toBe(HOST_HOME)
    expect(listedFolder('/srv', ['/srv/site'], parent)).toBe('/srv')
  })

  it('offers a Windows folder in its WSL spelling too', () => {
    expect(hostSpellings('/Users/ruan/dev/site')).toEqual(['/Users/ruan/dev/site'])
    expect(hostSpellings('C:\\Users\\ruan\\dev')).toEqual(['C:\\Users\\ruan\\dev', '/mnt/c/Users/ruan/dev'])
    expect(hostSpellings('D:\\')).toEqual(['D:\\', '/mnt/d'])
  })

  it('keeps the first spelling Hermes lists, and none when it lists none', async () => {
    const lists = (seen: string[]) => async (path: string) => {
      if (!seen.includes(path)) throw new Error('ENOENT')
    }
    expect(await firstListed(['C:\\dev', '/mnt/c/dev'], lists(['/mnt/c/dev']))).toBe('/mnt/c/dev')
    expect(await firstListed(['C:\\dev', '/mnt/c/dev'], lists(['C:\\dev', '/mnt/c/dev']))).toBe('C:\\dev')
    expect(await firstListed(['/Users/ruan/dev'], lists([]))).toBeNull()
  })
})

describe('a new chat’s project (desktop#605)', () => {
  const home = project('home', '/home/eric', true)
  const list = [home, project('Conduit', '/home/eric/projects/conduit'), project('Loose'), project('Site', '/srv/site/')]

  it('offers the profile’s projects with a folder; Home is No project', () => {
    expect(newChatProjects(list).map(p => p.id)).toEqual(['Conduit', 'Site'])
  })

  it('names the project whose folder the chat starts in, a trailing slash aside', () => {
    expect(projectFor('/srv/site', list)?.id).toBe('Site')
    expect(projectFor('/home/eric/projects/conduit/', list)?.id).toBe('Conduit')
    expect(projectFor('/home/eric', list)).toBeNull()
    expect(projectFor(undefined, list)).toBeNull()
    expect(projectFor('/srv/site', null)).toBeNull()
  })

  it('opens the host’s folders at the chat’s folder, else Home’s, else the host’s home folder', () => {
    expect(folderStart('/srv/app', list)).toBe('/srv/app')
    expect(folderStart(undefined, list)).toBe('/home/eric')
    expect(folderStart(undefined, [project('x')])).toBe(HOST_HOME)
    expect(folderStart(undefined, null)).toBe(HOST_HOME)
  })
})

describe('a new chat’s project, spelled otherwise (desktop#652 review)', () => {
  it('names the project whatever the folder’s case', () => {
    const list = [{ id: 'Site', title: 'Site', path: 'C:\\Dev\\Site', isHome: false, isAuto: false, count: 0, previews: [] }]
    expect(projectFor('c:\\dev\\site', list)?.id).toBe('Site')
  })

  it('prefers the exact spelling when two folders differ only by case', () => {
    const list = ['/srv/Site', '/srv/site'].map(path => ({ id: path, title: path, path, isHome: false, isAuto: false, count: 0, previews: [] }))
    expect(projectFor('/srv/site', list)?.id).toBe('/srv/site')
    expect(projectFor('/srv/Site', list)?.id).toBe('/srv/Site')
  })
})
