import { useEffect, useMemo, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { dockedRoomUrl, type DockedRoomRequest } from '@shared/chatWindows'
import { t } from '../../../shared/i18n'
import { ROOM_RULES_CAPABILITY } from '../state/roomChoices'
import { ROOM_LEAVE_CAPABILITY, canLeave as canLeaveCopy, copyApprovals, copyRoom } from '../state/roomCopies'
import { ROOM_FILES_CAPABILITY, ROOM_FILES_LINKED_CAPABILITY, ROOM_FILE_PICTURES_CAPABILITY } from '../state/roomFiles'
import { ROOM_CHATS_CAPABILITY, wrapUpPrompt } from '../state/roomChats'
import { openRoomChatHere } from '../state/roomChatOpen'
import { setAvatarHost, useBots } from '../state/useBots'
import { setPictureHost } from '../state/gatewayPictures'
import { useRooms } from '../state/useGroups'
import { useRoomInvites } from '../state/useRoomInvites'
import { useRoomCopies } from '../state/useRoomCopies'
import { useRoomLooks } from '../state/useRoomLooks'
import { GlowContext, useGlowColors } from './GlowColors'
import { RoomView } from './RoomView'

/**
 * Another combined dashboard's group chat, in a frame in the main window's
 * room pane (the phone's no-switch open, stage 2): the room it hosts, or its
 * copy of one hosted elsewhere, read and written on that dashboard's kept
 * connection, with no switch. Asking an agent about it (or Wrap Up) opens
 * that agent's chat docked in the main window's chat pane, Wrap Up's ask
 * left in its message box.
 */
export function DockedRoom({ request }: { request: DockedRoomRequest }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  const host = status?.url ?? ''
  useEffect(() => {
    setAvatarHost(host)
    setPictureHost(host)
  }, [host])
  const connected = status?.phase === 'open'
  const roster = useBots(connected, host, { withSessions: false })
  const glowBots = useMemo(() => [...(roster.bots ?? []), ...roster.hidden], [roster.bots, roster.hidden])
  const glowOf = useGlowColors(glowBots, host)
  const rooms = useRooms(connected, host)
  const invites = useRoomInvites(connected, host)
  const copies = useRoomCopies(connected, host, invites.capabilities)
  const looks = useRoomLooks(connected, host, invites.capabilities, roster.bots, glowOf)
  const caps = invites.capabilities
  const room = request.kind === 'room' ? rooms.rooms?.find(r => r.roomId === request.id) : undefined
  const copy = request.kind === 'copy' ? copies.copies.find(c => c.id === request.id) : undefined
  const copyAsRoom = useMemo(() => (copy ? copyRoom(copy) : null), [copy])
  const approvals = useMemo(() => (copy ? copyApprovals(copies.approvals, copy, copies.copies) : []), [copy, copies.approvals, copies.copies])
  const [note, setNote] = useState<string | null>(null)
  const shown = room ?? copyAsRoom
  const onOpenRoomChat = caps.includes(ROOM_CHATS_CAPABILITY)
    ? async (agent: { profile: string }, wrapUp: boolean) => {
        if (!shown) return
        try {
          const opened = await openRoomChatHere(shown.roomId, shown.name, agent.profile, status?.sessionAuthority === true)
          window.conduit.openChat({ storedId: opened.chatId, profile: agent.profile, title: opened.title, host, ...(wrapUp ? { draft: wrapUpPrompt() } : {}) })
        } catch (e) {
          setNote(e instanceof Error ? e.message : t('The chat didn’t open. Try again.'))
        }
      }
    : undefined
  if (!host || !shown) return <div className="chat-window-page" />
  return (
    <GlowContext.Provider value={glowOf}>
      <div className="chat-window-page docked-room-page">
        {note ? (
          <p className="notice" role="alert">
            {note}
          </p>
        ) : null}
        {copy && copyAsRoom ? (
          <RoomView
            key={copy.id}
            room={copyAsRoom}
            readsStoredFiles={caps.includes(ROOM_FILE_PICTURES_CAPABILITY) && caps.includes(ROOM_FILES_LINKED_CAPABILITY)}
            people={{ canSetChoices: caps.includes(ROOM_RULES_CAPABILITY), freeBusy: invites.freeBusy, canLeave: copies.canLeave, onChanged: () => void copies.refresh() }}
            looks={looks.looks[copy.roomId]}
            onOpenRoomChat={onOpenRoomChat}
            bots={roster.bots ?? []}
            connected={connected}
            canStop={false}
            canAttach={false}
            copy={copy}
            onRefreshCopies={copies.refresh}
            canPostInCopy={copies.canPost}
            copyApprovals={approvals}
            copyAnswers={copies.answers}
            onAnswerCopyApproval={(approval, choice) => void copies.answer(approval, choice)}
            onLeaveCopy={
              canLeaveCopy(copy, copies.canLeave)
                ? async () => {
                    const kind = await copies.leave(copy)
                    void invites.refresh()
                    return kind
                  }
                : undefined
            }
          />
        ) : room ? (
          <RoomView
            key={room.roomId}
            room={room}
            storesFiles={caps.includes(ROOM_FILES_CAPABILITY)}
            people={{ canSetChoices: caps.includes(ROOM_RULES_CAPABILITY), freeBusy: invites.freeBusy, canLeave: caps.includes(ROOM_LEAVE_CAPABILITY), onChanged: () => void rooms.refresh() }}
            readsStoredFiles={caps.includes(ROOM_FILE_PICTURES_CAPABILITY)}
            looks={looks.looks[room.roomId]}
            onOpenRoomChat={onOpenRoomChat}
            bots={roster.bots ?? []}
            connected={connected}
            canStop={rooms.capabilities?.canStop === true}
            canAttach={rooms.capabilities?.attachments === true}
            canEditSettings={rooms.capabilities?.context === true}
            canContinueDiscussions={rooms.capabilities?.canContinue === true}
            canApprove={rooms.capabilities?.canApprove === true}
          />
        ) : null}
      </div>
    </GlowContext.Provider>
  )
}

/** The frame the main window's room pane shows another dashboard's group chat in; the parent keys it by dashboard and room. */
export function DockedRoomFrame({ room }: { room: DockedRoomRequest }) {
  return <webview className="docked-chat-frame" src={dockedRoomUrl(window.location.href, room)} />
}
