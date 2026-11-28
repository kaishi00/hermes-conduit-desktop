// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

const listed: Record<string, { name: string; path: string; isDirectory: boolean }[]> = {
  '/home/eric': [
    { name: 'projects', path: '/home/eric/projects', isDirectory: true },
    { name: 'notes.md', path: '/home/eric/notes.md', isDirectory: false }
  ],
  '/home/eric/projects': [{ name: 'site', path: '/home/eric/projects/site', isDirectory: true }],
  '/home/eric/projects/site': [],
  '/Users/ruan/dev': []
}
const created: unknown[] = []
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: async (_method: string, path: string) => {
      const url = new URL(path, 'http://x')
      if (url.pathname === '/api/fs/list') {
        const entries = listed[url.searchParams.get('path') ?? '']
        if (!entries) return { error: 'ENOENT' }
        return { entries }
      }
      return {}
    },
    rpc: async (method: string, params: Record<string, unknown>) => {
      created.push({ method, params })
      return { project: { id: 'p_new', label: params.name, primary_path: params.primary_path } }
    }
  },
  GatewayError: class extends Error {}
}))

let local = false
let picked: string[] | null = null
let picks = 0
beforeEach(() => {
  created.length = 0
  picks = 0
  ;(window as unknown as { conduit: unknown }).conduit = {
    platform: 'darwin',
    hostIsThisComputer: async () => local,
    pickLocalFolder: async () => {
      picks++
      return picked
    }
  }
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  })

async function renderForm(onDone = vi.fn(), start = '/home/eric') {
  const path = '../src/renderer/src/components/NewProjectForm.tsx'
  const { ProjectForm } = (await import(/* @vite-ignore */ path)) as { ProjectForm: unknown }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(createElement(ProjectForm as never, { withProfile: (p: object) => ({ ...p, profile: 'atlas' }), profile: 'atlas', start, onDone } as never)))
  await settle()
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label)) as HTMLButtonElement
  const folder = () => (host.querySelector('input[aria-label="Folder on the Hermes host"]') as HTMLInputElement).value
  return { host, button, folder, onDone }
}

describe('New Project’s Browse (desktop#605)', () => {
  it('shows the host’s folders when Hermes is elsewhere, and uses the one gone into', async () => {
    local = false
    const { host, button, folder } = await renderForm()
    act(() => button('Browse…').click())
    await settle()
    expect([...host.querySelectorAll('.host-folder')].map(b => b.textContent?.trim())).toEqual(['Back', 'projects'])
    act(() => button('projects').click())
    await settle()
    act(() => button('site').click())
    await settle()
    expect(host.querySelector('.host-folders-path')?.textContent).toBe('/home/eric/projects/site')
    act(() => button('Use This Folder').click())
    await settle()
    expect(folder()).toBe('/home/eric/projects/site')
    expect(host.querySelector('.host-folders')).toBeNull()
  })

  it('opens Finder when Hermes is on this computer, and keeps the spelling Hermes lists', async () => {
    local = true
    picked = ['C:\\Users\\ruan\\dev', '/Users/ruan/dev']
    const { host, button, folder } = await renderForm()
    act(() => button('Browse…').click())
    await settle()
    expect(folder()).toBe('/Users/ruan/dev')
    expect(host.querySelector('.host-folders')).toBeNull()
  })

  it('falls back to the host’s folders when Hermes can’t see the folder picked', async () => {
    local = true
    picked = ['/Volumes/elsewhere']
    const { host, button, folder } = await renderForm()
    act(() => button('Browse…').click())
    await settle()
    expect(folder()).toBe('')
    expect(host.querySelector('.project-error')?.textContent).toContain('Hermes can’t see that folder')
    expect(host.querySelector('.host-folders')).not.toBeNull()
    act(() => button('Use This Folder').click())
    await settle()
    expect(folder()).toBe('/home/eric')
    expect(host.querySelector('.project-error')).toBeNull()
  })

  it('makes the project in the profile, with the folder chosen', async () => {
    local = true
    picked = ['/Users/ruan/dev']
    const { host, button, onDone } = await renderForm()
    const name = host.querySelector('input[aria-label="Project name"]') as HTMLInputElement
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(name, 'Site')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button('Browse…').click())
    await settle()
    act(() => button('Create').click())
    await settle()
    expect(created).toEqual([{ method: 'projects.create', params: { name: 'Site', folders: ['/Users/ruan/dev'], primary_path: '/Users/ruan/dev', use: true, profile: 'atlas' } }])
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'p_new', path: '/Users/ruan/dev' }))
  })

  it('asks whether Hermes is here at the click, so a lookup that finished after the form opened still opens Finder (desktop issue 763)', async () => {
    local = false
    picked = ['/Users/ruan/dev']
    const { host, button, folder } = await renderForm()
    local = true
    act(() => button('Browse…').click())
    await settle()
    expect(folder()).toBe('/Users/ruan/dev')
    expect(host.querySelector('.host-folders')).toBeNull()
  })

  it('opens one Finder for two quick clicks', async () => {
    local = true
    picked = ['/Users/ruan/dev']
    const { button } = await renderForm()
    act(() => {
      button('Browse…').click()
      button('Browse…').click()
    })
    await settle()
    expect(picks).toBe(1)
  })

  it('opens the host’s folders at its home when nothing names a folder, and offers it only once Hermes names its path (desktop issue 763)', async () => {
    local = false
    listed['~'] = [{ name: 'projects', path: '/home/eric/projects', isDirectory: true }]
    const { host, button, folder } = await renderForm(vi.fn(), '~')
    act(() => button('Browse…').click())
    await settle()
    expect(host.querySelector('.host-folders-path')?.textContent).toBe('/home/eric')
    expect(button('Use This Folder').disabled).toBe(false)
    act(() => button('Use This Folder').click())
    await settle()
    expect(folder()).toBe('/home/eric')
    listed['~'] = []
    const empty = await renderForm(vi.fn(), '~')
    act(() => empty.button('Browse…').click())
    await settle()
    expect(empty.host.querySelector('.host-folders-path')?.textContent).toBe('~')
    expect(empty.button('Use This Folder').disabled).toBe(true)
    expect(empty.button('New Folder').disabled).toBe(true)
    delete listed['~']
  })
})
