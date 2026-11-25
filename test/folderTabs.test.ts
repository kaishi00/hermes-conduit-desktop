import { describe, expect, it } from 'vitest'
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
    expect(next.files[0]).toEqual({ entry: { path: '/r/new/a', name: 'a' }, draft: 'x' })
    expect(next.active).toBe('/r/new/a')
    expect(next.files[1]).toBe(tabs.files[1])
  })
})
