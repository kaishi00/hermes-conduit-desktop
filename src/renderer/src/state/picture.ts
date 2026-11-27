/**
 * Turning a picked, pasted or dropped file into a staged attachment. A
 * picture whose long edge is over 2048 px goes as a 2048 px JPEG (quality
 * 0.85), or PNG when some of its pixels are see-through, as on the phone; one
 * that size or smaller, a GIF, or one the resize wouldn't make smaller goes as
 * it is. A picture in a type providers don't read (BMP, TIFF...) goes as JPEG
 * when Chromium can draw it, else as a file. A picture that goes as it is
 * takes its type from its bytes and a name with that type's extension.
 */
import { isPicture, pictureExtension, pictureType, typedPicture, withPictureExtension, type StagedAttachment } from './attachments'

const LONG_EDGE = 2048
const JPEG_QUALITY = 0.85

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** Whether any pixel is see-through. */
function hasTransparency(context: OffscreenCanvasRenderingContext2D, width: number, height: number): boolean {
  const data = context.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/** The picture redrawn at most 2048 px on its long edge, or null when it can't be drawn. */
async function redraw(file: Blob, force: boolean): Promise<{ blob: Blob; mime: string; ext: string } | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height)
    if (long <= LONG_EDGE && !force) return null
    const scale = long > LONG_EDGE ? LONG_EDGE / long : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    const png = hasTransparency(context, width, height)
    const mime = png ? 'image/png' : 'image/jpeg'
    const blob = await canvas.convertToBlob(png ? { type: mime } : { type: mime, quality: JPEG_QUALITY })
    return { blob, mime, ext: png ? 'png' : 'jpg' }
  } finally {
    bitmap.close()
  }
}

/** A file as the composer stages it. */
export async function stageFile(file: File, id: string): Promise<StagedAttachment> {
  let mime = (file.type || '').toLowerCase()
  // A file whose name doesn't say it's a picture ("Event 8.30") is one when
  // its bytes are (issue 3331).
  if (!mime || mime === 'application/octet-stream') {
    mime = pictureType(new Uint8Array(await file.slice(0, 16).arrayBuffer())) ?? mime
  }
  const name = file.name || (mime.startsWith('image/') ? withPictureExtension('image', pictureExtension(mime)) : 'file')
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
    const provider = isPicture(mime)
    if (mime !== 'image/gif') {
      const drawn = await redraw(file, !provider)
      if (drawn && (!provider || drawn.blob.size < file.size)) {
        return { id, name: withPictureExtension(name, drawn.ext), kind: 'image', mime: drawn.mime, size: drawn.blob.size, base64: await readBase64(drawn.blob) }
      }
    }
    if (provider) {
      // Its bytes say what it is, and its name follows (issue 3331); bytes
      // that aren't a picture Hermes takes go as a file, since a provider
      // refuses the whole message over a picture it can't read.
      const base64 = await readBase64(file)
      const typed = typedPicture(name, base64)
      if (typed) return { id, name: typed.name, kind: 'image', mime: typed.mime, size: file.size, base64 }
      return { id, name, kind: 'file', mime, size: file.size, base64 }
    }
  }
  return { id, name, kind: 'file', mime: mime || 'application/octet-stream', size: file.size, base64: await readBase64(file) }
}

/** The model's copy of a picture shown to a live call: a JPEG of at most 1280 px and 190 KB (Qwen refuses one over 256 KB in Base64), as on the phone. */
export const MODEL_FRAME_EDGE = 1280
export const MODEL_FRAME_BYTES = 190_000

/** `file` as a live model's frame, base64 JPEG, or null when it can't be drawn small enough. */
export async function modelFrame(file: Blob): Promise<string | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    let edge = MODEL_FRAME_EDGE
    for (let attempt = 0; attempt < 6; attempt++) {
      const long = Math.max(bitmap.width, bitmap.height)
      const scale = Math.min(1, edge / long)
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
      const context = canvas.getContext('2d')
      if (!context) return null
      // A see-through picture on white, as a JPEG has no transparency.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: attempt < 3 ? 0.8 - attempt * 0.15 : 0.5 })
      if (blob.size <= MODEL_FRAME_BYTES) return readBase64(blob)
      if (attempt >= 2) edge = Math.round(edge * 0.75)
    }
    return null
  } finally {
    bitmap.close()
  }
}
