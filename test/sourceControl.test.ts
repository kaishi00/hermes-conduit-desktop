import { describe, expect, it } from 'vitest'
import { actionPath, commitsAll, diffLines, hostPath, letter, lists, parseBranches, parseDiff, parseLog, parseStatus, splitPath, statusPath } from '../src/renderer/src/state/sourceControl'

describe('source control', () => {
  it('reads a repository status, dropping rows it cannot use', () => {
    const status = parseStatus({
      repo: true,
      root: '/srv/site',
      top: '/srv/site',
      branch: { head: 'main', upstream: 'origin/main', ahead: 2, behind: 0 },
      files: [
        { path: 'src/a.ts', staged: 'modified', unstaged: null, stagedAdded: 3, stagedRemoved: 1 },
        { path: 'b.md', staged: null, unstaged: 'untracked' },
        { path: '.env', staged: null, unstaged: 'modified', secret: true },
        { path: '' },
        'nonsense'
      ]
    })
    expect(status.repo).toBe(true)
    if (!status.repo) return
    expect(status.branch).toEqual({ head: 'main', upstream: 'origin/main', ahead: 2, behind: 0, detached: false })
    expect(status.files.map(f => f.path)).toEqual(['src/a.ts', 'b.md', '.env'])
    expect(status.files[2]!.secret).toBe(true)
    const { staged, unstaged } = lists(status.files)
    expect(staged.map(f => f.path)).toEqual(['src/a.ts'])
    expect(unstaged.map(f => f.path)).toEqual(['b.md', '.env'])
    expect(commitsAll(status)).toBe(false)
  })

  it('commits everything listed when nothing is staged', () => {
    const status = parseStatus({ repo: true, root: '/r', files: [{ path: 'x', staged: null, unstaged: 'modified' }] })
    expect(commitsAll(status)).toBe(true)
    expect(commitsAll(parseStatus({ repo: false, root: '/r' }))).toBe(false)
  })

  it('reads a folder that is not a repository', () => {
    expect(parseStatus({ repo: false, root: '/srv/notes' })).toEqual({ repo: false, root: '/srv/notes' })
    expect(parseStatus(null)).toEqual({ repo: false, root: '' })
  })

  it('reads diffs, branches and commits', () => {
    expect(parseDiff({ path: 'a', staged: true, diff: '@@', binary: false })).toEqual({ path: 'a', staged: true, diff: '@@', binary: false, truncated: false })
    expect(parseBranches({ local: [{ name: 'main', current: true }, { name: '' }], remote: [{ name: 'origin/dev' }] })).toEqual({
      local: [{ name: 'main', upstream: null, current: true }],
      remote: [{ name: 'origin/dev', upstream: null, current: false }]
    })
    const [commit] = parseLog({ commits: [{ hash: 'abcdef123456', subject: 'Fix', time: 10, refs: ['main', 3] }, { subject: 'no hash' }] })
    expect(commit).toMatchObject({ short: 'abcdef1', subject: 'Fix', time: 10_000, refs: ['main'] })
  })

  it('numbers diff lines on both sides and leaves the file header out', () => {
    const lines = diffLines(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -3,3 +3,3 @@ fn', ' same', '-old', '+new', '\\ No newline at end of file'].join('\n'))
    expect(lines).toEqual([
      { kind: 'hunk', text: '@@ -3,3 +3,3 @@ fn' },
      { kind: 'context', text: 'same', old: 3, new: 3 },
      { kind: 'remove', text: 'old', old: 4, new: null },
      { kind: 'add', text: 'new', old: null, new: 4 },
      { kind: 'note', text: 'No newline at end of file' }
    ])
  })

  it('names rows and paths', () => {
    expect(letter('untracked')).toBe('U')
    expect(letter('conflict')).toBe('!')
    expect(letter(null)).toBe('')
    expect(splitPath('src/pages/index.astro')).toEqual({ name: 'index.astro', folder: 'src/pages' })
    expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' })
    expect(hostPath('/srv/site/', 'src/a.ts')).toBe('/srv/site/src/a.ts')
    expect(hostPath('C:\\code\\site', 'src/a.ts')).toBe('C:\\code\\site\\src\\a.ts')
  })

  it('asks the profile it reads', () => {
    expect(statusPath('/srv/a b')).toBe('/api/plugins/conduit_push/workspace/git/status?root=%2Fsrv%2Fa%20b')
    expect(statusPath('/r', 'work')).toContain('profile=work')
    expect(actionPath('commit')).toBe('/api/plugins/conduit_push/workspace/git/commit')
  })
})
