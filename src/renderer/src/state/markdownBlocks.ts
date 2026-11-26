/**
 * A streaming reply's markdown in blocks that parse on their own (desktop#198).
 * A reply grows at its end, so every block but the last is settled: drawn
 * once and kept, while only the open last block parses again as text comes.
 * A finished reply is parsed whole again, so what stays on screen is exactly
 * the single parse.
 *
 * A split falls only on a blank line outside a code fence where the next
 * line starts a block of its own, which ends whatever came before in
 * CommonMark and GFM alike: not indented (a list item's continuation, an
 * indented code block), and not a list item (a loose list stays one list,
 * its numbering and spacing kept). A reply with a link reference or
 * footnote definition, an HTML block that can run across blank lines, or a
 * `<details>` fold (htmlInReplies), isn't split at all, since those reach
 * across blocks.
 */

// A backtick fence's info string has no backtick (CommonMark), or the line is a paragraph.
const FENCE = /^\s{0,3}(`{3,}(?!.*`)|~{3,})/
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])(\s|$)/
// A definition counts inside a quote or list item too: it reaches the whole reply.
const REACHES_ACROSS = /^(?:\s{0,3}(?:>|[-*+]|\d{1,9}[.)])\s?)*\s{0,3}(\[[^\]]+\]:|<(!--|script|pre|style|textarea|details|\?|![A-Za-z]|!\[CDATA\[))/im

export function markdownBlocks(text: string): string[] {
  if (REACHES_ACROSS.test(text)) return [text]
  const lines = text.split('\n')
  const blocks: string[] = []
  let start = 0
  let fence: string | null = null
  let blankBefore = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fenceMatch = FENCE.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length && !line.trim().slice(fenceMatch[1]!.length).trim()) fence = null
      blankBefore = false
      continue
    }
    const blank = !line.trim()
    if (!blank && blankBefore && i > start && !/^\s/.test(line) && !LIST_ITEM.test(line)) {
      const block = lines.slice(start, i).join('\n').replace(/\n+$/, '')
      if (block.trim()) blocks.push(block)
      start = i
    }
    if (fenceMatch) fence = fenceMatch[1]!
    blankBefore = blank
  }
  const last = lines.slice(start).join('\n')
  if (last.trim() || !blocks.length) blocks.push(last)
  return blocks
}
