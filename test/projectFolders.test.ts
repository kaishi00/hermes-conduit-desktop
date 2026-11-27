import { describe, expect, it } from 'vitest'
import { firstListed, folderStart, newChatProjects, projectFor } from '../src/renderer/src/state/projectFolders'
import type { Project } from '../src/renderer/src/state/projects'
import { hostSpellings, isThisComputer } from '../src/main/localFolders'

const project = (id: string, path?: string, isHome = false): Project => ({ id, title: id, path, isHome, isAuto: false, count: 0, previews: [] })

describe('a project’s folder from this computer (desktop#605)', () => {
  const deps = { hostname: () => 'Ruans-MacBook', addresses: () => ['127.0.0.1', '192.168.1.20', 'fe80::1', '::1'] }

  it('counts loopback, this computer’s name and its own addresses as this computer', () => {
    for (const url of ['http://localhost:9119', 'http://127.0.0.1:9119', 'http://[::1]:9119', 'http://ruans-macbook.local:9119', 'http://Ruans-MacBook:9119', 'http://192.168.1.20:9119'])
      expect(isThisComputer(url, deps), url).toBe(true)
  })

  it('counts any other host, a missing address and a broken one as elsewhere', () => {
    for (const url of ['http://192.168.1.21:9119', 'https://hermes.example.com', 'http://ruans-macbook.example.com', undefined, 'not a url'])
      expect(isThisComputer(url, deps), String(url)).toBe(false)
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

  it('opens the host’s folders at the chat’s folder, else Home’s, else Hermes’ default', () => {
    expect(folderStart('/srv/app', list)).toBe('/srv/app')
    expect(folderStart(undefined, list)).toBe('/home/eric')
    expect(folderStart(undefined, [project('x')])).toBe('')
    expect(folderStart(undefined, null)).toBe('')
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
