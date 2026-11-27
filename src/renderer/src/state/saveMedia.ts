/**
 * Saving what a chat or the workspace shows to this computer, where the
 * person picks: a file on the Hermes host (streamed by the main process), or
 * a picture already drawn from its data.
 */
import { t } from '../../../shared/i18n'
import { tell } from './dialogs'

/** Saves a host file; null when saved or cancelled, else what went wrong. */
export async function saveHostFile(path: string, profile?: string | null): Promise<string | null> {
  const outcome = await window.conduit.saveHostFile(path, profile ?? undefined)
  return outcome === 'saved' || outcome === 'cancelled' ? null : outcome
}

/** Saves a picture from the data or blob URL it's drawn from; false when cancelled or unreadable. */
export async function saveFromUrl(src: string, name: string): Promise<boolean> {
  try {
    // The page's policy keeps fetch to its own files, so a data URL is decoded here.
    const bytes = src.startsWith('data:') ? dataUrlBytes(src) : await (await fetch(src)).arrayBuffer()
    return bytes ? await window.conduit.saveBytes(name, bytes) : false
  } catch {
    return false
  }
}

/**
 * Copies a picture from the data or blob URL it's drawn from to the clipboard
 * as a picture, never its address: PNG and JPEG as they are, any other kind
 * the page draws (GIF, WebP, SVG) as a PNG of it. False when it couldn't.
 */
export async function copyPicture(src: string): Promise<boolean> {
  try {
    const bytes = src.startsWith('data:') ? dataUrlBytes(src) : await (await fetch(src)).arrayBuffer()
    if (bytes && (await window.conduit.copyImage(bytes))) return true
    const png = await drawnAsPng(src)
    return png ? await window.conduit.copyImage(png) : false
  } catch {
    return false
  }
}

/** The picture at `src` as the page draws it, as PNG bytes; null when it won't draw. */
async function drawnAsPng(src: string): Promise<ArrayBuffer | null> {
  const image = new Image()
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const context = canvas.getContext('2d')
  if (!context || !canvas.width || !canvas.height) return null
  context.drawImage(image, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  return blob ? await blob.arrayBuffer() : null
}

/** Says what went wrong, if anything. */
export function sayIfFailed(error: string | null): void {
  if (error) void tell(error)
}

/** Opens a page on the Hermes host (.html, .htm, .xhtml) in the default browser from a copy, saying so when it can't (desktop#554). */
export async function openPageInBrowser(path: string, profile?: string | null): Promise<void> {
  try {
    sayIfFailed(await window.conduit.openHostPageInBrowser(path, profile ?? undefined))
  } catch {
    sayIfFailed(t("Couldn't open this file"))
  }
}

/** A base64 data URL's bytes, or null when it isn't one. */
export function dataUrlBytes(src: string): ArrayBuffer | null {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(src)
  if (!match) return null
  try {
    const text = atob(match[1]!)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return bytes.buffer
  } catch {
    return null
  }
}

/** A file name for a picture, with the extension its data URL names when it has none. */
export function pictureFileName(name: string, src: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name
  const type = /^data:image\/([a-z0-9+.-]+)/i.exec(src)?.[1]?.toLowerCase()
  const ext = type === 'jpeg' ? 'jpg' : type === 'svg+xml' ? 'svg' : type
  return ext ? `${name || 'Picture'}.${ext}` : name || 'Picture'
}
