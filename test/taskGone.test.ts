import { describe, expect, it } from 'vitest'

import { taskGone } from '../src/renderer/src/state/taskGone'

describe('a task gone from its board', () => {
  it('counts only a 404, not a message that says not found', () => {
    expect(taskGone({ code: 404, error: 'task not found' })).toBe(true)
    expect(taskGone({ code: 500, error: 'task not found' })).toBe(false)
    expect(taskGone({ error: 'task not found' })).toBe(false)
    expect(taskGone(new Error('network down'))).toBe(false)
    expect(taskGone(null)).toBe(false)
  })
})
