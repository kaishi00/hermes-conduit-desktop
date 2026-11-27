import { describe, expect, it } from 'vitest'
import { lookUpLink, resolvePath } from '../src/renderer/src/state/workspace'
import { servedAnswerHolds } from '../src/renderer/src/state/linkOpener'
import { localSpelling } from '../src/main/localFolders'

// Desktop issue 686: a folder link a reply named, looked up for the chat as the phone looks files up.
describe('a path link', () => {
  const ask = (answer: unknown, served = true) => {
    const asked: string[] = []
    return {
      asked,
      options: {
        sessionIds: ['s1', 's2'],
        profile: 'atlas',
        serves: async () => served,
        get: async (route: string) => {
          asked.push(route)
          if (answer instanceof Error) throw answer
          return answer
        }
      }
    }
  }

  it('asks the plugin for a relative path, with each id the chat goes by and its profile', () => {
    expect(resolvePath('.agents/skills/x/', ['s1', '', 's2'], 'atlas')).toBe(
      '/api/plugins/conduit_push/workspace/resolve?path=.agents%2Fskills%2Fx%2F&session_id=s1&session_id=s2&profile=atlas'
    )
  })

  it('opens a folder the plugin found as a folder, and a file as a file', async () => {
    const folder = ask({ ok: true, path: '/Users/r/project/.agents/skills/x', isDirectory: true })
    expect(await lookUpLink('.agents/skills/x/', folder.options)).toEqual({ path: '/Users/r/project/.agents/skills/x/' })
    expect(folder.asked).toHaveLength(1)
    expect(await lookUpLink('x/SKILL.md', ask({ ok: true, path: '/p/x/SKILL.md', isDirectory: false }).options)).toEqual({ path: '/p/x/SKILL.md' })
    expect(await lookUpLink('src', ask({ path: 'C:\\w\\src', isDirectory: true }).options)).toEqual({ path: 'C:\\w\\src\\' })
  })

  it('names what the host doesn’t have, for the notice', async () => {
    expect(await lookUpLink('.agents/skills/link-para-skill/', ask({ ok: true, path: null }).options)).toEqual({ missing: 'link-para-skill' })
  })

  it('leaves a rooted path as it is, and joins the chat’s folder when the plugin can’t say', async () => {
    const rooted = ask({ path: '/nope' })
    expect(await lookUpLink('/Users/r/a.md', rooted.options)).toEqual({ path: '/Users/r/a.md' })
    expect(rooted.asked).toEqual([])
    expect(await lookUpLink('a/b/', ask({ path: null }, false).options)).toEqual({ unknown: true })
    expect(await lookUpLink('a/b/', ask(new Error('504')).options)).toEqual({ unknown: true })
    expect(await lookUpLink('a/b/', { ...ask({ path: '/x' }).options, sessionIds: [] })).toEqual({ unknown: true })
  })
})

describe('Show in Finder or Explorer', () => {
  it('spells a host path as this computer has it', () => {
    expect(localSpelling('~/proj/.agents/', { home: '/Users/r', windows: false })).toBe('/Users/r/proj/.agents')
    expect(localSpelling('/Users/r/a.md', { home: '/Users/r', windows: false })).toBe('/Users/r/a.md')
    expect(localSpelling('/mnt/c/dev/app/', { home: 'C:\\Users\\r', windows: true })).toBe('C:\\dev\\app')
    // A WSL home, or ~ there, isn't a path this computer can show.
    expect(localSpelling('/home/r/proj', { home: 'C:\\Users\\r', windows: true })).toBeNull()
    expect(localSpelling('~/proj', { home: 'C:\\Users\\r', windows: true })).toBeNull()
    expect(localSpelling('C:/dev/app/x.ts', { home: 'C:\\Users\\r', windows: true })).toBe('C:\\dev\\app\\x.ts')
    expect(localSpelling('/', { home: '/Users/r', windows: false })).toBe('/')
  })
})

describe('the plugin’s answer about folder lookups', () => {
  it('keeps a yes, and asks again a minute after a no', () => {
    expect(servedAnswerHolds(true, 0, 10 * 60_000)).toBe(true)
    expect(servedAnswerHolds(false, 0, 30_000)).toBe(true)
    expect(servedAnswerHolds(false, 0, 61_000)).toBe(false)
  })
})
