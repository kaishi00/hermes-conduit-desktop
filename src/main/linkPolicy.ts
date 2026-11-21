/**
 * Which links leave the app for the browser or the system (navigation.ts
 * applies them to every window). Kept free of Electron so they're tested
 * on their own.
 */

/** A link a page opens (a click, `window.open`): web pages, and a Pulse card's mail, phone and message links; Maps and Calendar links on a Mac. */
export function opensExternally(url: string, mac: boolean): boolean {
  return /^(https?:\/\/|mailto:|tel:|sms:)/i.test(url) || (mac && /^(maps:|calshow:|x-apple-reminderkit:)/i.test(url))
}

/** A navigation the window refuses (a link followed in place, a page Hermes drew leaving its frame) goes to the browser only when it's a web page. */
export function navigatesToBrowser(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * A frame's navigation: the window's own page and the pages Hermes drew
 * stay, and anything else a frame follows is refused (`will-frame-navigate`).
 */
export function frameStays(isMainFrame: boolean, isPage: boolean): boolean {
  return isMainFrame || isPage
}
