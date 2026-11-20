import { createContext, memo, useContext, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { looksLikePath } from '../state/workspace'
import { remarkDesktopCards } from '../state/desktopCards'
import { markdownBlocks } from '../state/markdownBlocks'
import { DesktopCard } from './DesktopCard'

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

/** A reply's markdown. Raw HTML in it stays text; links open in the browser. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        code: ({ className, children }) => <Code className={className}>{children}</Code>,
        // A directive only Hermes Desktop draws: its card (remarkDesktopCards).
        ...({
          'desktop-card': ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
            const p = node?.properties ?? {}
            return <DesktopCard name={String(p.dataName ?? '')} source={String(p.dataSource ?? '')} id={String(p.dataId ?? '')} />
          }
        } as object)
      }}
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
