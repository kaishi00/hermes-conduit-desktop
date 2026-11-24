import { describe, expect, it } from 'vitest'
import { createParams, gatherProjects, parseProjectChats, parseProjects, type Project } from '../src/renderer/src/state/projects'

describe('projects', () => {
  it('reads the tree: Home, a made project and a folder one', () => {
    const list = parseProjects({
      projects: [
        { id: '__no_project__', isNoProject: true, label: 'Home', previewSessions: [{ id: 's1', title: 'Loose', last_active: 10 }] },
        { id: 'p_abc', label: 'Site', primary_path: '/srv/site', session_count: 4 },
        { id: 'auto:/srv/tools', label: 'tools', repos: [{ path: '/srv/tools' }] }
      ]
    })
    expect(list.map(p => [p.id, p.isHome, p.isAuto, p.path, p.count])).toEqual([
      ['__no_project__', true, false, undefined, 1],
      ['p_abc', false, false, '/srv/site', 4],
      ['auto:/srv/tools', false, true, '/srv/tools', 0]
    ])
    expect(list[0].previews[0]).toMatchObject({ id: 's1', title: 'Loose', lastActive: 10_000 })
  })

  it('takes a server isAuto over the id guess, and skips rows with no id', () => {
    const list = parseProjects([{ id: 'x1', is_auto: false, name: 'Mine' }, { label: 'nothing' }])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ isAuto: false, title: 'Mine' })
  })

  it('puts a project chats in lanes, named with their repo when there are several', () => {
    const one = parseProjectChats({
      project: {
        id: 'p_1',
        label: 'Site',
        repos: [
          {
            label: 'site',
            groups: [
              { label: 'main', path: '/srv/site', sessions: [{ id: 'a' }] },
              { label: 'empty', sessions: [] }
            ]
          }
        ]
      }
    })!
    expect(one.lanes.map(l => [l.title, l.path, l.chats.length])).toEqual([['main', '/srv/site', 1]])
    const two = parseProjectChats({
      project: {
        id: 'p_1',
        repos: [
          { label: 'a', groups: [{ label: 'g', sessions: [{ id: '1' }] }] },
          { label: 'b', groups: [{ label: 'g', sessions: [{ id: '2' }] }] }
        ]
      }
    })!
    expect(two.lanes.map(l => l.title)).toEqual(['a · g', 'b · g'])
  })

  it('falls back to a Recent lane, and to null with no project', () => {
    expect(parseProjectChats({ project: { id: 'p_1', previewSessions: [{ session_id: 'z' }] } })!.lanes[0]).toMatchObject({
      title: 'Recent',
      chats: [{ id: 'z' }]
    })
    expect(parseProjectChats({})).toBeNull()
  })

  it('sends create with the folder as its primary path', () => {
    expect(createParams(' Site ', ' /srv/site ')).toEqual({ name: 'Site', folders: ['/srv/site'], primary_path: '/srv/site', use: true })
  })
})

describe('gatherProjects (desktop#393)', () => {
  const project = (id: string, isHome = false): Project => ({ id, title: id, isHome, isAuto: false, count: 0, previews: [] })

  it('lists every profile’s projects, each naming its profile, the Homes first', () => {
    const all = gatherProjects([
      { profile: 'default', title: 'Hermes', projects: [project('home', true), project('p_site')] },
      { profile: 'coder', title: 'Coder', projects: [project('home', true), project('p_site')] }
    ])
    expect(all.map(p => `${p.profileTitle}:${p.id}`)).toEqual(['Hermes:home', 'Coder:home', 'Hermes:p_site', 'Coder:p_site'])
    expect(all[3]!.profile).toBe('coder')
  })
})
