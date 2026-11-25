/**
 * The open chat's read state. The chat on screen reads as read as it goes,
 * new activity included, unless it was marked unread while open: that mark
 * stays, through new activity and Hermes' flag coming back, until another
 * chat is opened, the way the phone keeps an explicit mark on the chat on
 * screen until it's opened again (AppState+ChatList's noteActiveChatSeen,
 * respectingMarks).
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ChatRow } from './chats'
import { isUnread, markKey, markRead, markUnread, type ChatMarks } from './chatMarks'

/** The open chat marked unread: the selection it was marked under, and its row's key. */
interface KeptUnread {
  openId: string
  key: string
}

export function useOpenChatRead(
  /** The selection open on screen, by its stored id when it has one. */
  openId: string | null | undefined,
  /** That chat's row in the list, when the list has it. */
  openRow: ChatRow | undefined,
  marks: ChatMarks,
  updateMarks: (change: (current: ChatMarks) => ChatMarks) => void,
  /** Hermes' shared read flag. */
  writeUnread: (row: ChatRow, unread: boolean) => void
): (row: ChatRow) => void {
  const kept = useRef<KeptUnread | null>(null)
  const openKey = openRow ? markKey(openRow) : undefined
  useEffect(() => {
    // Another chat opened, or none: the mark is the list's again. A list read
    // that briefly lacks the open chat's row leaves it, the selection unchanged.
    if (kept.current && kept.current.openId !== openId) kept.current = null
    if (!openRow) return
    if (kept.current?.key === openKey) return
    updateMarks(current => markRead(current, openRow))
    if (openRow.unread) writeUnread(openRow, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the row's key, activity and flag read it again; a new row object alone doesn't
  }, [openId, openKey, openRow?.activeAt, openRow?.unread, updateMarks, writeUnread])
  return useCallback(
    (row: ChatRow) => {
      const unread = isUnread(marks, row)
      if (openId && openKey === markKey(row)) kept.current = unread ? null : { openId, key: openKey }
      updateMarks(current => (unread ? markRead(current, row) : markUnread(current, row)))
      if (unread ? row.unread : !row.unread) writeUnread(row, !unread)
    },
    [marks, openId, openKey, updateMarks, writeUnread]
  )
}
