import { createContext, isValidElement, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { looksLikePath } from '../state/workspace'
import type { FileLinkActions } from '../state/linkOpener'
import { faviconFailed, faviconUrl, fileType } from '../state/linkMarks'
import { remarkDesktopCards } from '../state/desktopCards'
import { remarkHtmlTags, withFoldsApart } from '../state/htmlInReplies'
import { markdownBlocks } from '../state/markdownBlocks'
import { DesktopCard } from './DesktopCard'
import { PictureImage } from './Picture'
import { Icon } from './icons'
import { SESSION_LINK, sessionInLink } from '../state/workLinks'
import { WorkLinks } from './WorkLinkCard'
import { t } from '@shared/i18n'

// A single newline is a line break, as replies are written for chat, not for a page.
// The few tags that read as text draw (htmlInReplies); any other HTML stays text.
const plugins = [remarkGfm, remarkBreaks, remarkDesktopCards, remarkHtmlTags]

/** Opens a file path a reply names in inline code, in the Folder, and its right-click menu; null where there's no folder. */
export const FileLinks = createContext<FileLinkActions | null>(null)

/** A file's type beside its name (issue 455): its extension in capitals, the type's name on hover. */
function FileType({ path }: { path: string }) {
  const type = fileType(path)
  return type ? (
    <span className="file-type" title={type.name} aria-hidden="true">
      {type.label}
    </span>
  ) : null
}

/** Inline code: a link when it names a file and there's a Folder to open it in; a file's name carries its type. */
function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const links = useContext(FileLinks)
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every(c => typeof c === 'string') ? children.join('') : null
  // A block's code ends with its newline, and carries its language.
  const path = text && !className && !text.includes('\n') && looksLikePath(text) ? text : null
  if (links && path) {
    return (
      <code
        className="file-link"
        role="link"
        tabIndex={0}
        title={path}
        onClick={() => links.open(path)}
        onContextMenu={e => {
          // Show in Folder, Show in Finder or Explorer when Hermes is this computer, Copy Path (desktop issue 686).
          e.preventDefault()
          e.stopPropagation()
          links.menu(path)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') links.open(path)
          else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            links.menu(path)
          }
        }}
      >
        <FileType path={path} />
        {path}
      </code>
    )
  }
  if (path) {
    return (
      <code className={className}>
        <FileType path={path} />
        {children}
      </code>
    )
  }
  return <code className={className}>{children}</code>
}

/** A site's own icon before a link to it (issue 455); nothing where it has none, or can't be asked. */
function Favicon({ href }: { href?: string }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : faviconUrl(href)
  return src ? (
    <img
      className="link-favicon"
      src={src}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        faviconFailed(href)
        setFailed(true)
      }}
    />
  ) : null
}

/** The text inside a node, as a code block's children hold it. */
export function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainText).join('')
  if (isValidElement(node)) return plainText((node.props as { children?: ReactNode }).children)
  return ''
}

/** What a code block's Copy takes: its code as written, without the newline a fence's code ends with. */
export function codeToCopy(children: ReactNode): string {
  return plainText(children).replace(/\n$/, '')
}

/** A code block with a Copy button that is always shown, so a draft or a command can be taken in one tap. */
function Pre({ children }: { children?: ReactNode }) {
  // Read on each draw: `children` is a new node every time, so a memo on it never held.
  const code = codeToCopy(children)
  // The code copied (or the code whose copy failed), and a count, so a second
  // click restarts the 1.5 s note rather than ending the first one's. The note
  // shows only while the block still holds that code: a surface that swaps one
  // text for another in place reuses this block, and its new code hasn't been
  // copied.
  const [copied, setCopied] = useState<{ code: string; n: number; failed?: true } | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  // A write that lands after the block has gone changes nothing.
  const here = useRef(true)
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
    }
  }, [])
  const noted = copied?.code === code ? copied : null
  const shown = !!noted && !noted.failed
  const failed = !!noted?.failed
  // An icon on screen, so the button doesn't compete with the code; its words are
  // for screen readers: the label, and "Copied" (or that it couldn't) announced
  // while the mark shows.
  return (
    <div className="code-block">
      <button
        type="button"
        className={shown ? 'code-copy copied' : failed ? 'code-copy failed' : 'code-copy'}
        aria-label={t('Copy')}
        title={failed ? t("Couldn't copy") : t('Copy')}
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => here.current && setCopied(c => ({ code, n: (c?.n ?? 0) + 1 })),
            () => here.current && setCopied(c => ({ code, n: (c?.n ?? 0) + 1, failed: true }))
          )
        }
      >
        <Icon name={shown ? 'check' : failed ? 'close' : 'copy'} />
      </button>
      <span className="sr-only" aria-live="polite">
        {shown ? t('Copied') : failed ? t("Couldn't copy") : ''}
      </span>
      <pre>{children}</pre>
    </div>
  )
}

/** A link to a chat (`conduit://session/…`): opens it in the chat's column, where there is one; plain words elsewhere. */
function ChatLink({ href, children }: { href: string; children?: ReactNode }) {
  const actions = useContext(WorkLinks)
  const session = sessionInLink(href)
  if (!actions || !session) return <span>{children}</span>
  return (
    <a
      href={href}
      className="chat-link"
      onClick={e => {
        e.preventDefault()
        actions.open(session.sessionId, session.profile)
      }}
    >
      <InLink.Provider value>{children}</InLink.Provider>
    </a>
  )
}

/** Set inside a link: a picture there is part of the link, so a click follows it. */
const InLink = createContext(false)

/** A Markdown picture: a reply's picture that opens larger, or inside a link the same picture as the link's (Eric 2026-11-27). */
function MarkdownPicture({ src, name, title }: { src: string; name: string; title?: string }) {
  return useContext(InLink) ? (
    <span className="reply-picture linked-picture">
      <img src={src} alt={name} title={title || name} />
    </span>
  ) : (
    <PictureImage src={src} name={name} title={title} className="reply-picture" />
  )
}

// Links to chats stay links; anything else as react-markdown allows it.
const urlTransform = (url: string) => (url.startsWith(SESSION_LINK) ? url : defaultUrlTransform(url))

// Made once, so each element keeps its component across renders: a streaming
// reply redraws its last block, and a fresh renderer would remount its Copy button.
const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith(SESSION_LINK) ? (
      <ChatLink href={href}>{children}</ChatLink>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        <Favicon href={href} />
        <InLink.Provider value>{children}</InLink.Provider>
      </a>
    ),
  pre: ({ children }) => <Pre>{children}</Pre>,
  code: ({ className, children }) => <Code className={className}>{children}</Code>,
  // A Markdown picture draws as a reply's picture: never wider than its column, a click opens it larger.
  img: ({ src, alt, title }) =>
    typeof src === 'string' && src ? <MarkdownPicture src={src} name={alt || t('Image')} title={title} /> : alt ? <>{alt}</> : null,
  // A directive only Hermes Desktop draws: its card (remarkDesktopCards).
  ...({
    'desktop-card': ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      const p = node?.properties ?? {}
      return <DesktopCard name={String(p.dataName ?? '')} source={String(p.dataSource ?? '')} id={String(p.dataId ?? '')} />
    }
  } as object)
}

/** A reply's markdown. Its text tags draw (htmlInReplies), other raw HTML stays text; links open in the browser, links to chats in the app. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      urlTransform={urlTransform}
      components={components}
    >
      {withFoldsApart(text)}
    </ReactMarkdown>
  )
})

/** A streaming reply's markdown: each settled block drawn once and kept, the open last one parsed per change (markdownBlocks). */
export function StreamingMarkdown({ text }: { text: string }) {
  const blocks = markdownBlocks(text)
  return (
    <>
      {blocks.map((block, i) => (
        <Markdown key={i} text={block} />
      ))}
    </>
  )
}
