import { describe, expect, it } from 'vitest'
import {
  displayName,
  fileReference,
  formatReferenceValue,
  isPastedTextName,
  pastedTextName,
  promptText,
  stagePaste,
  titlePreview,
  tooLargeMessage,
  roomUploadKind,
  typedPicture,
  withPictureExtension,
  roomUploadProblem,
  uploadAttachments,
  uploadRoomAttachments,
  type StagedAttachment
} from '../src/renderer/src/state/attachments'
import { uploadTimeoutMs } from '../src/main/connection'
import { addPendingUser, emptyTranscript } from '../src/renderer/src/state/transcript'

const picture = (name = 'cat.png'): StagedAttachment => ({ id: name, name, kind: 'image', mime: 'image/png', size: 3, base64: 'AAA=' })
const doc = (name = 'notes.pdf'): StagedAttachment => ({ id: name, name, kind: 'file', mime: 'application/pdf', size: 3, base64: 'BBB=' })

/** A fake gateway that records calls and answers from a table. */
function gateway(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const rpc = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params })
    const answer = answers[method]
    if (!answer) throw new Error(`unexpected ${method}`)
    return answer(params) as T
  }
  return { rpc, calls }
}

describe('pasted text', () => {
  it('is named the way Hermes Desktop names a paste, and read back as one', () => {
    const name = pastedTextName(new Date(Date.UTC(2026, 10, 18, 5, 7, 9, 42)), 0xab12)
    expect(name).toBe('pasted_content_2026-11-18_05-07-09-042_00ab12.txt')
    expect(isPastedTextName(name)).toBe(true)
    expect(isPastedTextName(`/home/me/.hermes/uploads/x_${name.replace('.txt', '-2.txt')}`)).toBe(true)
    expect(isPastedTextName('pasted_content.txt')).toBe(false)
    expect(displayName(name)).toBe('Pasted text')
    expect(displayName('report.pdf')).toBe('report.pdf')
  })

  it('stages as UTF-8 text and gives the chat its title', () => {
    const paste = stagePaste('héllo ' + 'x'.repeat(1200), 'p')
    expect(paste.kind).toBe('file')
    expect(paste.mime).toBe('text/plain')
    expect(new TextDecoder().decode(Uint8Array.from(atob(paste.base64), c => c.charCodeAt(0)))).toBe(paste.pastedText)
    expect(titlePreview([picture(), paste])).toHaveLength(1000)
    expect(titlePreview([picture()])).toBeUndefined()
  })
})

describe('the prompt', () => {
  it('puts the files ahead of the words', () => {
    expect(promptText('look', ['@file:/a.pdf', '@file:/b.txt'])).toBe('@file:/a.pdf\n@file:/b.txt\n\nlook')
    expect(promptText('  ', ['@file:/a.pdf'])).toBe('@file:/a.pdf')
    expect(promptText('look', [])).toBe('look')
  })

  it('takes the reply’s reference, else builds one from its path', () => {
    expect(fileReference({ ref_text: '@file:/u/a.pdf' })).toBe('@file:/u/a.pdf')
    expect(fileReference({ ref_text: '', path: '/u/my notes.pdf' })).toBe('@file:`/u/my notes.pdf`')
    expect(fileReference({})).toBeNull()
    expect(formatReferenceValue('a`b c')).toBe('"a`b c"')
  })

  it('names the limit that refused a file', () => {
    expect(tooLargeMessage(['big.mov'])).toBe('big.mov is larger than the 16 MB attachment limit.')
    expect(tooLargeMessage(['a', 'b'])).toBe('These files are larger than the 16 MB attachment limit: a, b.')
  })
})

describe('uploadAttachments', () => {
  it('holds pictures on the dashboard and sends files as references', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png' }),
      'file.attach': p => ({ attached: true, ref_text: `@file:/up/${p.name}` })
    })
    const out = await uploadAttachments(rpc, 's1', 'work', false, [picture(), doc()])
    expect(out).toEqual({ references: ['@file:/up/notes.pdf'], images: [], heldImagePaths: ['/img/cat.png'] })
    expect(calls[0]).toEqual({ method: 'image.attach_bytes', params: { session_id: 's1', profile: 'work', content_base64: 'AAA=', filename: 'cat.png' } })
    expect(calls[1].params).toMatchObject({ data_url: 'data:application/pdf;base64,BBB=', name: 'notes.pdf', path: '' })
  })

  it('names the session authority’s staged pictures for the prompt', async () => {
    const { rpc } = gateway({ 'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png', mime: 'image/png' }) })
    const out = await uploadAttachments(rpc, 's1', undefined, true, [picture()])
    expect(out.images).toEqual([{ path: '/img/cat.png', mime: 'image/png' }])
    expect(out.heldImagePaths).toEqual([])
  })

  it('sends a picture Hermes refuses as an image as a file', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => {
        throw Object.assign(new Error('unsupported image'), { code: 4016 })
      },
      'file.attach': () => ({ attached: true, path: '/up/cat.png' })
    })
    const out = await uploadAttachments(rpc, 's1', undefined, false, [picture()])
    expect(out.references).toEqual(['@file:/up/cat.png'])
    expect(calls.map(c => c.method)).toEqual(['image.attach_bytes', 'file.attach'])
  })

  it('takes back held pictures when a later file fails', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png' }),
      'file.attach': () => {
        throw new Error('disk full')
      },
      'image.detach': () => ({ detached: true, count: 0 })
    })
    await expect(uploadAttachments(rpc, 's1', undefined, false, [picture(), doc()])).rejects.toThrow('disk full')
    expect(calls.at(-1)).toEqual({ method: 'image.detach', params: { session_id: 's1', path: '/img/cat.png' } })
  })
})

describe('upload budget', () => {
  it('is two minutes, or about 1 s per 64 KB carried', () => {
    expect(uploadTimeoutMs({ text: 'x'.repeat(10_000_000) })).toBe(120_000)
    expect(uploadTimeoutMs({ content_base64: 'x'.repeat(64_000 * 300) })).toBe(300_000)
    expect(uploadTimeoutMs({ data_url: 'x'.repeat(64_000 * 200) })).toBe(200_000)
  })
})

describe('a sent message’s files', () => {
  it('show on its bubble while it is on its way', () => {
    const state = addPendingUser(emptyTranscript, '', [{ kind: 'image', value: 'cat.png' }])
    expect(state.items.at(-1)).toMatchObject({ kind: 'user', text: '', pending: true, attachments: [{ kind: 'image', value: 'cat.png' }] })
  })
})

const b64 = (bytes: number[] | string) => btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes))
const staged = (name: string, mime: string, base64: string, size = 10): StagedAttachment => ({ id: `id-${name}`, name, kind: 'file', mime, size, base64 })

describe('a room’s files', () => {
  it('go as the kind Hermes tells from their bytes', () => {
    expect(roomUploadKind(staged('a.png', 'image/png', b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])))).toEqual({ kind: 'image', mime: 'image/png' })
    expect(roomUploadKind(staged('a.jpg', 'image/png', b64([0xff, 0xd8, 0xff, 0xe0])))).toEqual({ kind: 'image', mime: 'image/jpeg' })
    expect(roomUploadKind(staged('d.pdf', '', b64('%PDF-1.7 body')))).toEqual({ kind: 'pdf', mime: 'application/pdf' })
    expect(roomUploadKind(staged('n.txt', 'text/plain', b64('hello'))) ).toEqual({ kind: 'file', mime: 'text/plain' })
    expect(roomUploadKind(staged('x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b64('PK\x03\x04')))).toEqual({
      kind: 'file',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
  })

  it('leave out what Hermes takes as nothing', () => {
    expect(roomUploadKind(staged('p.heic', 'image/heic', b64('ftypheic')))).toBeNull()
    expect(roomUploadKind(staged('bin.txt', 'text/plain', b64([0x61, 0, 0x62])))).toBeNull()
    expect(roomUploadKind(staged('big.zip', 'application/zip', b64('PK'), 15_000_001))).toBeNull()
    expect(roomUploadProblem([staged('p.heic', 'image/heic', b64('ftypheic'))])).toBe('A group chat can’t take p.heic.')
    expect(roomUploadProblem(Array.from({ length: 9 }, (_, i) => staged(`${i}.txt`, 'text/plain', b64('hi'))))).toBe('A group chat message takes up to 8 files.')
    expect(roomUploadProblem([staged('a.zip', 'application/zip', b64('PK'), 14_000_000), staged('b.zip', 'application/zip', b64('PK'), 14_000_000)])).toBe(
      'A group chat message takes up to 25 MB of files.'
    )
    expect(roomUploadProblem([staged('n.txt', 'text/plain', b64('hello'))])).toBeNull()
  })

  it('upload with a retry key made of the staged file and its bytes', async () => {
    const { rpc, calls } = gateway({
      'groups.attachment.upload': p => ({ attachment_id: `att-${p.name}`, kind: p.kind, name: p.name, size: 5, mime: p.mime, state: 'uploaded' })
    })
    const file = staged('n.txt', 'text/plain', b64('hello'), 5)
    const manifests = await uploadRoomAttachments(rpc, 'r1', [file])
    expect(manifests).toEqual([{ attachment_id: 'att-n.txt', kind: 'file', name: 'n.txt', size: 5, mime: 'text/plain' }])
    expect(calls[0].params).toMatchObject({ room_id: 'r1', kind: 'file', name: 'n.txt', mime: 'text/plain', data_base64: file.base64 })
    // sha256("hello") starts 2cf24dba5fb0a30e26e83b2a.
    expect(calls[0].params.upload_id).toBe('conduit-id-ntxt-2cf24dba5fb0a30e26e83b2a')
    await expect(uploadRoomAttachments(rpc, 'r1', [staged('p.heic', 'image/heic', b64('x'))])).rejects.toThrow('can’t take')
    expect(calls).toHaveLength(1)
  })
})

describe('a room upload’s budget', () => {
  it('has a three-minute floor', () => {
    expect(uploadTimeoutMs({ data_base64: 'x' })).toBe(180_000)
    expect(uploadTimeoutMs({ data_base64: 'x'.repeat(64_000 * 400) })).toBe(400_000)
  })
})

describe('a picture sent as it is', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]

  it('takes a name that says what its bytes are (issue 3331)', () => {
    expect(typedPicture('Event 8.30', b64(png))).toEqual({ name: 'Event 8.30.png', mime: 'image/png' })
    expect(typedPicture('flyer.jpg', b64(png))).toEqual({ name: 'flyer.png', mime: 'image/png' })
    expect(typedPicture('IMG_1.JPG', b64([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ name: 'IMG_1.JPG', mime: 'image/jpeg' })
    expect(typedPicture('cat.png', b64(png))).toEqual({ name: 'cat.png', mime: 'image/png' })
  })

  it('replaces any picture extension and drops trailing dots', () => {
    expect(typedPicture('photo.heic', b64(png))).toEqual({ name: 'photo.png', mime: 'image/png' })
    expect(typedPicture('Apple.', b64(png))).toEqual({ name: 'Apple.png', mime: 'image/png' })
    expect(withPictureExtension('Event 8.30', 'jpg')).toBe('Event 8.30.jpg')
    expect(withPictureExtension('IMG_1.HEIC', 'jpg')).toBe('IMG_1.jpg')
    expect(withPictureExtension('', 'png')).toBe('image.png')
  })

  it('is no picture when Hermes wouldn’t take its bytes as one', () => {
    expect(typedPicture('photo.jpg', b64('not a picture'))).toBeNull()
    expect(typedPicture('photo.jpg', '')).toBeNull()
  })
})
