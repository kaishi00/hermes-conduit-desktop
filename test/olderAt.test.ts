import { describe, expect, it } from 'vitest'
import { mergedOlderAt } from '../src/renderer/src/state/longChat'

describe('merging a kept page position with a resumed one (issue 550)', () => {
  it('takes both offset and more from the same record, the one that got further back', () => {
    expect(mergedOlderAt({ offset: 1500, more: false }, { offset: 500, more: true })).toEqual({ offset: 1500, more: false })
    expect(mergedOlderAt({ offset: 500, more: true }, { offset: 1500, more: false })).toEqual({ offset: 1500, more: false })
    expect(mergedOlderAt(null, { offset: 500, more: true })).toEqual({ offset: 500, more: true })
  })
})
