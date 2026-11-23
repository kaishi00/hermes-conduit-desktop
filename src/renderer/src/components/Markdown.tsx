import { createContext, isValidElement, memo, useContext, useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { looksLikePath } from '../state/workspace'
import { remarkDesktopCards } from '../state/desktopCards'
import { markdownBlocks } from '../state/markdownBlocks'
import { DesktopCard } from './DesktopCard'
import { SESSION_LINK, sessionInLink } from '../state/workLinks'
import { WorkLinks } from './WorkLinkCard'
import { t } from '@shared/i18n'

// A single newline is a line break, as replies are written for chat, not for a page.
const plugins = [remarkGfm, remarkBreaks, remarkDesktopCards]

/** Opens a file path a reply names in inline code, in the Folder; null where there's no folder. */
export const FileLinks = createContext<((path: string) => void) | null>(null)

/** Inline code: a link when it names a file and there's a Folder to open it in. */
function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const open = useContext(FileLinks)
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every(c => typeof c === 'string') ? children.join('') : null
  // A block's code ends with its newline, and carries its language.
  if (open && text && !className && !text.includes('\n') && looksLikePath(text)) {
    return (
      <code
        className="file-link"
        role="link"
        tabIndex={0}
        title={text}
        onClick={() => open(text)}
        onKeyDown={e => {
          if (e.key === 'Enter') open(text)
        }}
      >
        {text}
      </code>
    )
  }
  return <code className={className}>{children}</code>
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
  // Counts copies, so a second click restarts the 1.5 s "Copied" rather than ending the first one's.
  const [copied, setCopied] = useState(0)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(0), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const code = codeToCopy(children)
  return (
    <div className="code-block">
      <button
        type="button"
        className="link code-copy"
        aria-live="polite"
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => setCopied(n => n + 1),
            () => undefined
          )
        }
      >
        {copied ? t('Copied') : t('Copy')}
      </button>
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
      {children}
    </a>
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
        {children}
      </a>
    ),
  pre: ({ children }) => <Pre>{children}</Pre>,
  code: ({ className, children }) => <Code className={className}>{children}</Code>,
  // A directive only Hermes Desktop draws: its card (remarkDesktopCards).
  ...({
    'desktop-card': ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      const p = node?.properties ?? {}
      return <DesktopCard name={String(p.dataName ?? '')} source={String(p.dataSource ?? '')} id={String(p.dataId ?? '')} />
    }
  } as object)
}

/** A reply's markdown. Raw HTML in it stays text; links open in the browser, links to chats in the app. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      urlTransform={urlTransform}
      components={components}
    >
      {text}
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
