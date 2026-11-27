/**
 * The right-click menu on text, in every window: a text field gets spelling
 * suggestions for a misspelled word, Undo, Redo, Cut, Copy, Paste and Select
 * All, as the phone's fields get iOS's edit menu; selected text elsewhere gets
 * Copy, a link gets Copy Link, and a picture gets Copy Image, which puts the
 * picture itself on the clipboard, as the phone's long-press Copy does.
 * Electron shows no menu of its own, so without this a right-click on the
 * composer did nothing.
 *
 * A menu Conduit draws itself (a chat row's, a finished reply's selection
 * menu) cancels the page's contextmenu event, and then Electron never asks
 * for this one.
 */
import { BrowserWindow, Menu, clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { t } from '../shared/i18n'

type Params = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags' | 'linkURL'> &
  Partial<Pick<ContextMenuParams, 'mediaType' | 'hasImageContents'>>

export interface EditMenuActions {
  replaceMisspelling: (word: string) => void
  addToDictionary: (word: string) => void
  copyText: (text: string) => void
  /** Copies the picture right-clicked. */
  copyImage: () => void
}

/** Copy Link only for the links Conduit opens itself: web pages, mail and phone links. */
const copyableLink = (url: string) => /^(https?:|mailto:|tel:|sms:)/i.test(url)

export function editMenuTemplate(params: Params, actions: EditMenuActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, 5)
    for (const word of suggestions) items.push({ label: word, click: () => actions.replaceMisspelling(word) })
    if (!suggestions.length) items.push({ label: t('No Suggestions'), enabled: false })
    const word = params.misspelledWord
    items.push({ label: t('Add to Dictionary'), click: () => actions.addToDictionary(word) }, { type: 'separator' })
  }
  if (params.isEditable) {
    const flags = params.editFlags
    items.push(
      { label: t('Undo'), role: 'undo', enabled: flags.canUndo },
      { label: t('Redo'), role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { label: t('Cut'), role: 'cut', enabled: flags.canCut },
      { label: t('Copy'), role: 'copy', enabled: flags.canCopy },
      { label: t('Paste'), role: 'paste', enabled: flags.canPaste },
      { type: 'separator' },
      { label: t('Select All'), role: 'selectAll', enabled: flags.canSelectAll }
    )
  } else if (params.selectionText.trim()) {
    items.push({ label: t('Copy'), role: 'copy' })
  }
  if (params.mediaType === 'image' && params.hasImageContents) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: t('Copy Image'), click: () => actions.copyImage() })
  }
  if (params.linkURL && copyableLink(params.linkURL)) {
    // A mail or phone link copies the address or number alone, without its ?subject= or body
    // (iOS's sms: links put &body= straight after the number). One with neither, such as
    // mailto:?subject=, has nothing to copy, so it gets no Copy Link.
    const text = /^https?:/i.test(params.linkURL) ? params.linkURL : params.linkURL.replace(/^(mailto|tel|sms):([^?#&]*).*$/i, '$2')
    if (text) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ label: t('Copy Link'), click: () => actions.copyText(text) })
    }
  }
  return items
}

/** Shows the menu for each right-click in this page, its frames included. */
export function watchEditMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template = editMenuTemplate(params, {
      replaceMisspelling: word => contents.replaceMisspelling(word),
      addToDictionary: word => contents.session.addWordToSpellCheckerDictionary(word),
      copyText: text => clipboard.writeText(text),
      copyImage: () => contents.copyImageAt(params.x, params.y)
    })
    const window = BrowserWindow.fromWebContents(contents) ?? undefined
    if (template.length) Menu.buildFromTemplate(template).popup({ window })
  })
}
