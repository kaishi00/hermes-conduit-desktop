import { describe, expect, it } from 'vitest'
import { LIST_COLUMN, PANEL_COLUMN, besideChatFits, shownListWidth, shownPanelWidth, shownWindowPanelWidth, snapsShut, storedAfterDrag, storedAfterStep } from '../src/renderer/src/state/columnWidths'

describe('column widths', () => {
  it('drags within the column bounds, and a press that barely moves stores nothing', () => {
    expect(storedAfterDrag(320, 100, 1, LIST_COLUMN)).toBe(420)
    expect(storedAfterDrag(320, 400, 1, LIST_COLUMN)).toBe(520)
    expect(storedAfterDrag(320, -200, 1, LIST_COLUMN)).toBe(240)
    expect(storedAfterDrag(340, -100, -1, PANEL_COLUMN)).toBe(440)
    expect(storedAfterDrag(320, 3, 1, LIST_COLUMN)).toBeNull()
  })

  it('steps by 40 within the bounds', () => {
    expect(storedAfterStep(320, true, LIST_COLUMN)).toBe(360)
    expect(storedAfterStep(250, false, LIST_COLUMN)).toBe(240)
    expect(storedAfterStep(700, true, PANEL_COLUMN)).toBe(720)
  })

  it('keeps the chat its least width and the panel its room on a wide window', () => {
    expect(shownListWidth(null, 1600)).toBeNull()
    expect(shownListWidth(500, 1600)).toBe(500)
    // 1280 has room for the panel beside a standard list: the list keeps it.
    expect(shownListWidth(500, 1280)).toBe(1280 - 72 - 430 - 340)
    // 1000 doesn't: the list only leaves the chat its least.
    expect(shownListWidth(500, 1000)).toBe(1000 - 72 - 430)
    expect(shownListWidth(500, 600)).toBe(240)
    expect(shownPanelWidth(700, 1280, 320)).toBe(1280 - 72 - 320 - 430)
    expect(shownPanelWidth(400, 1600, 320)).toBe(400)
    expect(shownPanelWidth(700, 900, 320)).toBe(300)
  })
})

describe('a chat beside the open one', () => {
  it('fits only where the chat keeps its least width beside the pane', () => {
    // 72 rail + 320 list + 430 chat + 300 pane.
    expect(besideChatFits(1122, 320)).toBe(true)
    expect(besideChatFits(1121, 320)).toBe(false)
    expect(besideChatFits(900, 240)).toBe(false)
  })
})

describe('hiding the chat list by its line', () => {
  it('snaps shut only when dragged well past the least width', () => {
    // From 300 px: down to 240 (the least) and a little past it only narrows the list.
    expect(snapsShut(300, -60, 1, LIST_COLUMN)).toBe(false)
    expect(snapsShut(300, -130, 1, LIST_COLUMN)).toBe(false)
    expect(snapsShut(300, -141, 1, LIST_COLUMN)).toBe(true)
    // Widening never hides it.
    expect(snapsShut(300, 200, 1, LIST_COLUMN)).toBe(false)
  })

  it("gives a chat's own page (a window, or a far chat docked in the pane) its panel short of the chat's least width", () => {
    expect(shownWindowPanelWidth(null, 1200)).toBeNull()
    expect(shownWindowPanelWidth(400, 1200)).toBe(400)
    expect(shownWindowPanelWidth(700, 1000)).toBe(1000 - 430)
    expect(shownWindowPanelWidth(500, 600)).toBe(PANEL_COLUMN.min)
  })
})
