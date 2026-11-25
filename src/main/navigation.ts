/**
 * The link policy every window shares (main, chat, Quick ask and Bot's
 * Screen windows): links open in the browser, never inside the app, and a
 * page Hermes drew stays in its frame. The rules are in linkPolicy.ts.
 */
import { shell, type WebContents } from 'electron'
import { frameStays, navigatesToBrowser, opensExternally } from './linkPolicy'
import { isPageUrl } from './pages'
import { viewerFrame } from './viewFileRules'

const isMac = process.platform === 'darwin'

export function confineNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (opensExternally(url, isMac)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A page Hermes drew stays in its frame, as does a file the viewer shows (and a PDF's viewer): a link it follows opens in the browser.
  contents.on('will-frame-navigate', event => {
    if (frameStays(event.isMainFrame, isPageUrl(event.url) || viewerFrame(event.url))) return
    event.preventDefault()
    if (navigatesToBrowser(event.url)) void shell.openExternal(event.url)
  })
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) {
      event.preventDefault()
      if (navigatesToBrowser(url)) void shell.openExternal(url)
    }
  })
}
