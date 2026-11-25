import { describe, expect, it } from 'vitest'
import { childPath } from '../src/renderer/src/state/workspace'
import { FOLDER_TAB_LIMIT, NO_TABS, closeTab, closeTabsUnder, renameTabs, showTab, updateTab, type FolderTabs } from '../src/renderer/src/state/folderTabs'

type F = { entry: { path: string; name: string }; draft?: string; text?: string }
const file = (path: string, more: Partial<F> = {}): F => ({ entry: { path, name: path.split('/').pop()! }, ...more })
const paths = (tabs: FolderTabs<F>) => tabs.files.map(f => f.entry.path)

describe('the Folder’s file tabs', () => {
  it('gives each file opened a tab and shows the newest', () => {
    const tabs = showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/b'))
    expect(paths(tabs)).toEqual(['/r/a', '/r/b'])
    expect(tabs.active).toBe('/r/b')
  })

  it('goes back to a file’s own tab when it’s opened again', () => {
    const tabs = showTab(showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/b')), file('/r/a', { text: 'new' }))
    expect(paths(tabs)).toEqual(['/r/a', '/r/b'])
    expect(tabs.active).toBe('/r/a')
  })

  it('puts a file opened from a reply’s folder in the shown tab’s place', () => {
    const tabs = showTab(showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/dir')), file('/r/dir/x'), true)
    expect(paths(tabs)).toEqual(['/r/a', '/r/dir/x'])
    expect(tabs.active).toBe('/r/dir/x')
  })

  it('past the limit drops the oldest tab without changes, never one with changes', () => {
    let tabs = showTab(NO_TABS as FolderTabs<F>, file('/r/0', { draft: 'kept' }))
    for (let i = 1; i < FOLDER_TAB_LIMIT; i++) tabs = showTab(tabs, file(`/r/${i}`))
    tabs = showTab(tabs, file('/r/new'))
    expect(tabs.files).toHaveLength(FOLDER_TAB_LIMIT)
    expect(paths(tabs)[0]).toBe('/r/0')
    expect(paths(tabs)).not.toContain('/r/1')
    expect(tabs.active).toBe('/r/new')
  })

  it('fills a tab’s read when another tab is shown', () => {
    const tabs = showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/b'))
    const next = updateTab(tabs, '/r/a', f => ({ ...f, text: 'read' }))
    expect(next.files[0].text).toBe('read')
    expect(next.active).toBe('/r/b')
    expect(updateTab(tabs, '/r/gone', f => f)).toBe(tabs)
  })

  it('closing the shown tab shows the one after it, else the one before, else the tree', () => {
    let tabs = showTab(showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/b')), file('/r/c'))
    tabs = { ...tabs, active: '/r/b' }
    tabs = closeTab(tabs, '/r/b')
    expect(tabs.active).toBe('/r/c')
    tabs = closeTab(tabs, '/r/c')
    expect(tabs.active).toBe('/r/a')
    tabs = closeTab(tabs, '/r/a')
    expect(tabs).toEqual({ files: [], active: null })
  })

  it('closing another tab keeps the shown one', () => {
    const tabs = closeTab(showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/a')), file('/r/b')), '/r/a')
    expect(tabs).toEqual({ files: [file('/r/b')], active: '/r/b' })
  })

  it('a delete closes the tabs of the path and everything under it', () => {
    const tabs = showTab(showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/dir/a')), file('/r/dirt')), file('/r/dir'))
    expect(paths(closeTabsUnder(tabs, '/r/dir'))).toEqual(['/r/dirt'])
  })

  it('a rename moves the tabs under it, drafts kept', () => {
    const tabs = showTab(showTab(NO_TABS as FolderTabs<F>, file('/r/dir/a', { draft: 'x' })), file('/r/other'))
    const next = renameTabs({ ...tabs, active: '/r/dir/a' }, '/r/dir', '/r/new')
    expect(next.files[0]).toEqual({ entry: { path: '/r/new/a', name: 'a' }, draft: 'x', saving: undefined, stale: true })
    expect(next.active).toBe('/r/new/a')
    expect(next.files[1]).toBe(tabs.files[1])
  })

  it('never drops another tab of the same file that has changes; it shows it instead', () => {
    let tabs = showTab(NO_TABS as FolderTabs<F>, file('/r/x.txt', { draft: 'typed' }))
    tabs = showTab(tabs, file('/r/dir'))
    const next = showTab(tabs, file('/r/x.txt'), true)
    expect(next.files.map(f => f.draft)).toEqual(['typed', undefined])
    expect(paths(next)).toEqual(['/r/x.txt', '/r/dir'])
    expect(next.active).toBe('/r/x.txt')
  })

  it('a rename closes a folder’s tab under it and forgets walks through it', () => {
    type G = F & { entry: F['entry'] & { isDirectory?: boolean }; back?: { path: string }[] }
    const dir: G = { entry: { path: '/r/dir', name: 'dir', isDirectory: true } }
    const walked: G = { entry: { path: '/r/other/y', name: 'y' }, back: [{ path: '/r/dir' }] }
    let tabs = showTab(showTab(NO_TABS as FolderTabs<G>, walked), dir)
    tabs = renameTabs(tabs, '/r/dir', '/r/new')
    expect(tabs.files).toEqual([{ ...walked, back: [] }])
    expect(tabs.active).toBe('/r/other/y')
  })

  it('a rename renames the entry in a folder tab that lists it', () => {
    type G = F & { entry: F['entry'] & { isDirectory?: boolean }; folder?: { entries: { path: string; name: string }[] } }
    const top: G = { entry: { path: '/r', name: 'r', isDirectory: true }, folder: { entries: [{ path: '/r/sub', name: 'sub' }, { path: '/r/a', name: 'a' }] } }
    const tabs = renameTabs(showTab(NO_TABS as FolderTabs<G>, top), '/r/sub', '/r/new')
    expect(tabs.files[0].folder?.entries).toEqual([{ path: '/r/new', name: 'new' }, { path: '/r/a', name: 'a' }])
  })

  it('a rename on a Windows host keeps its backslashes', () => {
    const tabs = showTab(NO_TABS as FolderTabs<F>, file('C:\\w\\a.txt'))
    const to = childPath('C:\\w', 'b.txt')
    expect(to).toBe('C:\\w\\b.txt')
    expect(renameTabs(tabs, 'C:\\w\\a.txt', to).files[0].entry).toEqual({ path: 'C:\\w\\b.txt', name: 'b.txt' })
    expect(childPath('/r/', 'x')).toBe('/r/x')
  })
})
