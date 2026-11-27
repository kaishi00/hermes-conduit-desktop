import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

const { editMenuTemplate } = await import('../src/main/editMenu')

const flags = { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canDelete: true, canEditRichly: false }
const params = (over: Partial<Parameters<typeof editMenuTemplate>[0]> = {}) => ({
  isEditable: false,
  selectionText: '',
  misspelledWord: '',
  dictionarySuggestions: [] as string[],
  editFlags: flags,
  linkURL: '',
  ...over
})
const actions = () => ({ replaceMisspelling: vi.fn(), addToDictionary: vi.fn(), copyText: vi.fn(), copyImage: vi.fn() })
const labels = (items: ReturnType<typeof editMenuTemplate>) => items.map(i => (i.type === 'separator' ? '—' : i.label))

describe('the right-click menu on text', () => {
  it('gives a text field the edit commands, each enabled as the field allows', () => {
    const items = editMenuTemplate(params({ isEditable: true }), actions())
    expect(labels(items)).toEqual(['Undo', 'Redo', '—', 'Cut', 'Copy', 'Paste', '—', 'Select All'])
    expect(items.find(i => i.label === 'Undo')?.enabled).toBe(false)
    expect(items.find(i => i.label === 'Paste')).toMatchObject({ role: 'paste', enabled: true })
  })

  it('puts spelling suggestions for a misspelled word first, and adds it to the dictionary', () => {
    const run = actions()
    const items = editMenuTemplate(params({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'] }), run)
    expect(labels(items).slice(0, 4)).toEqual(['the', 'tech', 'Add to Dictionary', '—'])
    items[0].click?.({} as never, undefined, {} as never)
    expect(run.replaceMisspelling).toHaveBeenCalledWith('the')
    items[2].click?.({} as never, undefined, {} as never)
    expect(run.addToDictionary).toHaveBeenCalledWith('teh')
  })

  it('says so when a misspelled word has no suggestions', () => {
    const items = editMenuTemplate(params({ isEditable: true, misspelledWord: 'qzx' }), actions())
    expect(items[0]).toMatchObject({ label: 'No Suggestions', enabled: false })
  })

  it('offers Copy for text selected outside a field, and nothing with no selection', () => {
    expect(labels(editMenuTemplate(params({ selectionText: 'a passage' }), actions()))).toEqual(['Copy'])
    expect(editMenuTemplate(params({ selectionText: '  ' }), actions())).toEqual([])
    expect(editMenuTemplate(params(), actions())).toEqual([])
  })

  it('copies a web link whole, and a mail link as its address', () => {
    const run = actions()
    const web = editMenuTemplate(params({ linkURL: 'https://example.com/a' }), run)
    expect(labels(web)).toEqual(['Copy Link'])
    web[0].click?.({} as never, undefined, {} as never)
    expect(run.copyText).toHaveBeenCalledWith('https://example.com/a')
    const mail = editMenuTemplate(params({ linkURL: 'mailto:a@b.co', selectionText: 'a@b.co' }), run)
    expect(labels(mail)).toEqual(['Copy', '—', 'Copy Link'])
    mail[2].click?.({} as never, undefined, {} as never)
    expect(run.copyText).toHaveBeenLastCalledWith('a@b.co')
    editMenuTemplate(params({ linkURL: 'mailto:a@b.co?subject=Hi' }), run)[0].click?.({} as never, undefined, {} as never)
    expect(run.copyText).toHaveBeenLastCalledWith('a@b.co')
    editMenuTemplate(params({ linkURL: 'sms:+15551234?body=Hey' }), run)[0].click?.({} as never, undefined, {} as never)
    expect(run.copyText).toHaveBeenLastCalledWith('+15551234')
    editMenuTemplate(params({ linkURL: 'sms:+15551234&body=Hey' }), run)[0].click?.({} as never, undefined, {} as never)
    expect(run.copyText).toHaveBeenLastCalledWith('+15551234')
    expect(editMenuTemplate(params({ linkURL: 'mailto:?subject=Share' }), run)).toEqual([])
    expect(editMenuTemplate(params({ linkURL: 'conduit-page://x' }), run)).toEqual([])
  })

  it('gives a picture Copy Image, which copies the picture itself, beside a selection and a link', () => {
    const run = actions()
    const picture = editMenuTemplate(params({ mediaType: 'image', hasImageContents: true }), run)
    expect(labels(picture)).toEqual(['Copy Image'])
    picture[0].click?.({} as never, undefined, {} as never)
    expect(run.copyImage).toHaveBeenCalledOnce()
    expect(labels(editMenuTemplate(params({ mediaType: 'image', hasImageContents: true, selectionText: 'hi', linkURL: 'https://x.dev' }), run))).toEqual([
      'Copy',
      '—',
      'Copy Image',
      '—',
      'Copy Link'
    ])
    // A picture that hasn't loaded has nothing to copy.
    expect(editMenuTemplate(params({ mediaType: 'image', hasImageContents: false }), run)).toEqual([])
  })
})
