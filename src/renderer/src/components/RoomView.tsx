import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bot } from "../state/bots";
import {
  addressing,
  canContinue,
  choosingWhoAnswers,
  dayLabel,
  latestDiscussionSettled,
  leadMemberId,
  memberStatusLabel,
  memberStatuses,
  pickableMembers,
  roomItems,
  routingChoices,
  startsNewDay,
  type Room,
  type RoomApproval,
} from "../state/groups";
import { RoomSettings } from "./RoomSettings";
import { RoomPeopleSheet } from "./RoomPeopleSheet";
import { parsePeople, withPeople, type RoomPerson } from "../state/roomChoices";
import { Fragment } from "react";
import { useRoom, type RoomApprovalAnswer } from "../state/useGroups";
import { useRoomCopy } from "../state/useRoomCopies";
import { ROOM_PEOPLE_PATH, approvalLine, copyHost, copyLine, copyReadOnly, isOver, leaveMessage, outLine, postRow, takesPosts, type CopyApproval, type RoomCopy } from "../state/roomCopies";
import { gateway } from "../gateway";
import { BotAvatar, LookFace, RoomFaces } from "./BotsHome";
import { memberLook, personLook, type RoomLooks } from "../state/roomLooks";
import { askLine, roomChatAgents, wrapUpLine, type RoomChatAgent } from "../state/roomChats";
import { Composer } from "./Composer";
import { MessageActions, QuotedCard, Reply, clock, quoteRequest, revealMessage } from "./Transcript";
import { blockquote, copyableReply, parseRoomReply, roomReplyText, sameQuotedText, type QuoteRequest } from "../state/quote";
import { Icon } from "./icons";
import { PictureImage, PictureProfile } from "./Picture";
import { displayName, roomUploadProblem } from "../state/attachments";
import { keptPictures, keptStoredPicture, readRoomPicture, readStoredPicture } from "../state/roomPictures";
import { isStoredRoomFile, linkedRoomFilesProblem } from "../state/roomFiles";
import { t } from "@shared/i18n";
import { JumpToLatest } from "./JumpToLatest"
import { atEnd } from "../state/scrollEnd";

interface Props {
  room: Room;
  /** The plugin stores room files (`room-files`): a room with other people's agents takes them that way. */
  storesFiles?: boolean;
  /** The plugin reads back the pictures it stored (and, in a copy, your host's copies of them). */
  readsStoredFiles?: boolean;
  /** Group Info's people in a room with other people's agents: your agents' choices (room-rules), Use my data's free/busy, and Take Out (room-leave). */
  people?: { canSetChoices: boolean; freeBusy: boolean; canLeave: boolean; onChanged: () => void };
  bots: Bot[];
  connected: boolean;
  canStop: boolean;
  /** The room's Hermes keeps files as its messages' own attachments. */
  canAttach: boolean;
  /** The host takes `groups.context`: Group Settings. */
  canEditSettings?: boolean;
  /** The host takes `groups.continue`. */
  canContinueDiscussions?: boolean;
  /** The host takes `groups.approve`: Run or Reject on a member's held tool call. */
  canApprove?: boolean;
  /** A room someone else hosts, read from this Hermes' copy of it: no composer, its people's messages under their names. */
  copy?: RoomCopy;
  /** Reads the copies again, for the copy's status. */
  onRefreshCopies?: () => Promise<void>;
  /** Deletes the copy once it's over, when the plugin can. */
  onDeleteCopy?: () => Promise<void>;
  /** This Hermes' plugin posts in rooms other people host. */
  canPostInCopy?: boolean;
  /** Your agents' approvals in the copy, each answered on its card. */
  copyApprovals?: CopyApproval[];
  copyAnswers?: Record<string, RoomApprovalAnswer>;
  onAnswerCopyApproval?: (approval: CopyApproval, choice: "once" | "deny") => void;
  /** Takes all your agents out of the copy, when the plugin can and they're still in. */
  onLeaveCopy?: () => Promise<"left" | "sending">;
  /** How the room's other people and their agents look, as their own Conduits gave it. */
  looks?: RoomLooks;
  /** Opens a private chat about the room with one of your agents (plugin room-chats), asking for notes with `wrapUp`. */
  onOpenRoomChat?: (agent: RoomChatAgent, wrapUp: boolean) => Promise<void>;
}

const noRefresh = async () => undefined;

/** A member's tool call the room holds for the user, above the composer: who asks, why, the command, Run and Reject. */
function RoomApprovalCard({
  approval,
  name,
  answer,
  canAnswer,
  onAnswer,
}: {
  approval: RoomApproval;
  name: string;
  answer?: RoomApprovalAnswer;
  canAnswer: boolean;
  onAnswer: (choice: "once" | "deny") => void;
}) {
  const sending = answer?.state === "sending" || answer?.state === "sent";
  const failure = answer?.state === "failed" ? answer.message : null;
  return (
    <section className="ask room-approval" aria-label={t("Approval needed")}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="code" />
        </span>
        <span className="ask-title">
          {t("Needs your OK")}
          <span className="ask-chat"> · {name}</span>
        </span>
        {sending ? <Icon name="spinner" style={{ animation: "spin 1s linear infinite" }} /> : null}
      </header>
      {approval.description ? <p className="ask-text">{approval.description}</p> : null}
      {approval.command ? <pre className="ask-command">{approval.command}</pre> : null}
      <div className="ask-actions">
        <button
          className="ask-btn primary"
          disabled={!canAnswer || sending || !approval.choices.includes("once")}
          onClick={() => onAnswer("once")}
        >
          {t("Run")}
        </button>
        <button
          className="ask-btn danger"
          disabled={!canAnswer || sending || !approval.choices.includes("deny")}
          onClick={() => onAnswer("deny")}
        >
          {t("Reject")}
        </button>
      </div>
      {failure ? <p className="ask-error">{failure}</p> : null}
    </section>
  );
}

interface ShownFile {
  kind: string;
  name: string;
  /** Where Hermes keeps it, to read a picture back. */
  attachmentId?: string;
  /** A picture's bytes already here (the sender's own, while it sends). */
  dataUrl?: string;
  /** Where the plugin stored it, for one an `@file:` line names. */
  path?: string;
}

/**
 * A picture in a room message, read back from Hermes, or from the plugin
 * for one it stored (`readsStored`); its name if it won't load.
 */
function RoomPicture({ roomId, eventId, file, readsStored }: { roomId: string; eventId?: string; file: ShownFile; readsStored?: boolean }) {
  const stored = file.path && readsStored && isStoredRoomFile(file.path) ? file.path : null;
  const [src, setSrc] = useState<string | null | undefined>(
    file.dataUrl ?? (stored ? keptStoredPicture(stored) : file.attachmentId ? keptPictures.get(file.attachmentId) : null),
  );
  useEffect(() => {
    if (src !== undefined) return;
    let live = true;
    const read = stored ? readStoredPicture(stored) : file.attachmentId && eventId ? readRoomPicture(roomId, eventId, file.attachmentId) : null;
    if (!read) return;
    void read.then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [src, roomId, eventId, file.attachmentId, stored]);
  if (!src) {
    return (
      <span className="chip" title={file.path ?? file.name}>
        <Icon name="image" />
        <span>{displayName(file.name)}</span>
      </span>
    );
  }
  return <PictureImage src={src} name={file.name} className="room-picture" />;
}

/** A room message's files: pictures as themselves, the rest by name. */
function FileChips({ files, roomId, eventId, readsStored }: { files: ShownFile[]; roomId: string; eventId?: string; readsStored?: boolean }) {
  return (
    <div className="attachments">
      {files.map((f, i) =>
        f.kind === "image" ? (
          <RoomPicture key={i} roomId={roomId} eventId={eventId} file={f} readsStored={readsStored} />
        ) : (
          <span key={i} className="chip" title={f.path ?? f.name}>
            <Icon name="file" />
            <span>{displayName(f.name)}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** A group chat: the user's messages and each bot's under its face and name, read from the room's log. */
export function RoomView({ room: givenRoom, storesFiles = false, readsStoredFiles = false, people, bots, connected, canStop, canAttach, canEditSettings, canContinueDiscussions, canApprove, copy, onRefreshCopies, onDeleteCopy, canPostInCopy = false, copyApprovals = [], copyAnswers = {}, onAnswerCopyApproval, onLeaveCopy, looks, onOpenRoomChat }: Props) {
  // Who's who in a room this Hermes hosts with linked people: owners, and who left or was taken out.
  const [whosWho, setWhosWho] = useState<{ roomId: string; people: Map<string, RoomPerson> } | null>(null);
  const [peopleRead, setPeopleRead] = useState(0);
  const readsPeople = !copy && givenRoom.linked && connected && !!people;
  useEffect(() => {
    if (!readsPeople) return;
    let live = true;
    const roomId = givenRoom.roomId;
    void gateway
      .http("GET", `${ROOM_PEOPLE_PATH}?room_id=${encodeURIComponent(roomId)}`)
      .then((answer) => {
        if (live) setWhosWho({ roomId, people: parsePeople(answer) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [readsPeople, givenRoom.roomId, peopleRead]);
  const room = useMemo(
    () => (whosWho && whosWho.roomId === givenRoom.roomId && !copy ? { ...givenRoom, members: withPeople(givenRoom.members, whosWho.people) } : givenRoom),
    [givenRoom, whosWho, copy],
  );
  // A copy reads its log from this Hermes' plugin; a room this Hermes hosts, from the gateway.
  const hosted = useRoom(copy ? null : givenRoom, connected, storesFiles);
  const copied = useRoomCopy(copy ?? null, connected, onRefreshCopies ?? noRefresh);
  const { pending, send, stop, saveContext, continueDiscussion, approvals, answers, approve } = hosted;
  const { events, status, loading, error } = copy ? copied : hosted;
  const host = copy ? copy.from.trim() || t("The host") : "";
  const copyYou = copied.you;
  const items = useMemo(() => roomItems(room, events, copy ? { host, you: copyYou } : undefined), [room, events, copy, host, copyYou]);
  const copyTakesPosts = !!copy && takesPosts(copy, canPostInCopy);
  const [deleting, setDeleting] = useState<"asking" | "deleting" | null>(null);
  const [leaving, setLeaving] = useState<"asking" | "leaving" | null>(null);
  const [leaveNote, setLeaveNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const botFor = (profile?: string) => bots.find((b) => b.name === profile);
  const memberBot = (memberId: string) => {
    const member = room.members.find((m) => m.memberId === memberId);
    // Another Hermes' agent is never one of yours, whatever its id.
    return member?.peer ? undefined : botFor(member?.profile ?? memberId);
  };
  // Your agents in a room with other people's, for a private chat about it.
  const chatAgents = onOpenRoomChat && connected ? roomChatAgents(room.members, (profile) => botFor(profile)?.title) : [];
  const [asking, setAsking] = useState(false);
  const [chatOpening, setChatOpening] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const openChat = async (agent: RoomChatAgent, wrapUp: boolean) => {
    if (!onOpenRoomChat || chatOpening) return;
    setChatOpening(`${agent.profile}|${wrapUp}`);
    setChatError(null);
    try {
      await onOpenRoomChat(agent, wrapUp);
      setAsking(false);
    } catch (e) {
      setChatError(t("Could not open the room's chat: {reason}", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setChatOpening(null);
    }
  };
  useEffect(() => {
    if (!asking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !chatOpening) {
        event.preventDefault();
        event.stopPropagation();
        setAsking(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking, chatOpening]);
  /** Another person's agent's look. */
  const peerLook = (memberId: string) => memberLook(looks, room.members.find((m) => m.memberId === memberId));
  /** A person's look by name; in a room someone else hosts, the host's by the host's name. */
  const lookOf = (name?: string) => personLook(looks, name, copy ? copy.from : undefined);
  const busyNames = status.busy.map(
    (id) => room.members.find((m) => m.memberId === id)?.displayName ?? id,
  );

  const scroller = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, pending, copied.outbox, status.working]);

  // A message replying to another: the "Replying to" card, then its own words.
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const replies = useMemo(() => {
    const map = new Map<string, { author: string; quote: string; message: string }>();
    for (const item of items) {
      if (item.kind !== "user" && item.kind !== "person") continue;
      const reply = parseRoomReply(item.text);
      if (reply) map.set(item.key, reply);
    }
    return map;
  }, [items]);
  const ownWords = (item: { key: string; text: string }) => replies.get(item.key)?.message ?? item.text;
  const jump = (quoted: string) => {
    const target = items.find((i) => i.kind === "member" && sameQuotedText(i.text, quoted));
    return target ? () => revealMessage(scroller.current, target.key) : undefined;
  };

  const names = room.members.map(
    (m) => m.displayName ?? m.profile ?? m.memberId,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const choosing = useMemo(() => choosingWhoAnswers(room, events, status.context), [room, events, status.context]);
  const showsSettings = !!canEditSettings && !!status.context && !status.disbanded;
  // How each bot did with the latest message, in pills under the title, as the phone and Hermes Desktop show it.
  const statuses = useMemo(() => memberStatuses(room, events, status), [room, events, status]);
  const lead = leadMemberId(room, status.context);
  const settled = useMemo(() => !status.working && latestDiscussionSettled(events, pending.length > 0), [events, pending.length, status.working]);
  // The composer's To row, as the phone's: the next message goes to the bots picked here, or to every bot.
  const pickable = useMemo(() => pickableMembers(room.members), [room.members]);
  const [recipients, setRecipients] = useState<string[]>([]);
  // A picked bot that leaves drops off, so the row shows who the next message goes to.
  const picked = recipients.filter((h) => pickable.some((m) => m.handle!.trim().toLowerCase() === h.toLowerCase()));
  const handleOf = (memberId: string) => pickable.find((m) => m.memberId === memberId)?.handle?.trim();
  const isPicked = (handle: string) => picked.some((h) => h.toLowerCase() === handle.toLowerCase());
  const toggle = (handle: string) =>
    setRecipients((list) => (list.some((h) => h.toLowerCase() === handle.toLowerCase()) ? list.filter((h) => h.toLowerCase() !== handle.toLowerCase()) : [...list, handle]));
  /** A pill or a bot's picture picks it in the To row, as on the phone, and the message box takes focus. */
  const pickMember = (memberId: string) => {
    const handle = handleOf(memberId);
    if (!handle) return;
    setRecipients((list) => (list.some((h) => h.toLowerCase() === handle.toLowerCase()) ? list : [...list, handle]));
    pane.current?.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
  };
  const canPick = connected && !status.disbanded && !copy;
  // A copy's pictures are the host's: not readable from this Hermes' gateway, so they show by name.
  const shownFiles = (files: ShownFile[]) => (copy ? files.map((f) => ({ ...f, attachmentId: undefined })) : files);
  return (
    <main className="chat room" ref={pane}>
      <div className="chat-head">
        <div className="chat-title room-title" title={names.join(", ")}>
          <RoomFaces room={room} bots={bots} size={20} looks={looks} />
          <span className="room-title-name">{room.name}</span>
          <span className="room-title-count">
            {copy
              ? copyApprovals.length
                ? t("Approval needed")
                : copyLine(copy)
              : approvals.length
              ? t("Approval needed")
              : choosing
              ? choosing.lead
                ? t("{name} is choosing who answers…", { name: choosing.lead })
                : t("Choosing who answers…")
              : settled
                ? t("Settled, nobody had more to say")
                : `${names.length} bots`}
          </span>
        </div>
        {chatAgents.length ? (
          <button
            className="chat-head-button"
            title={t("Ask Your Agent")}
            aria-label={t("Ask Your Agent")}
            onClick={() => {
              setChatError(null);
              setAsking(true);
            }}
          >
            <Icon name="chats" />
          </button>
        ) : null}
        {copy && onLeaveCopy ? (
          <button
            className="chat-head-button"
            title={t("Leave Room")}
            aria-label={t("Leave Room")}
            disabled={leaving === "leaving"}
            onClick={() => {
              setLeaveNote(null);
              setLeaving("asking");
            }}
          >
            <Icon name="leave" />
          </button>
        ) : null}
        {copy && onDeleteCopy && isOver(copy) ? (
          <button
            className="chat-head-button"
            title={t("Delete")}
            aria-label={t("Delete")}
            disabled={deleting === "deleting"}
            onClick={() => {
              setDeleteError(null);
              setDeleting("asking");
            }}
          >
            <Icon name="trash" />
          </button>
        ) : null}
        {people && room.linked && (people.canSetChoices || people.canLeave) ? (
          <button
            className="chat-head-button"
            title={t("Members")}
            aria-label={t("Members")}
            onClick={() => setPeopleOpen(true)}
          >
            <Icon name="linked" />
          </button>
        ) : null}
        {showsSettings ? (
          <button
            className="chat-head-button"
            title={t("Group Settings")}
            aria-label={t("Group Settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
        ) : null}
      </div>
      {room.members.length ? (
        <div className="room-pills" role="group" aria-label={t("Members")}>
          {room.members.map((member) => {
            const bot = memberBot(member.memberId);
            const shown = statuses.get(member.memberId);
            const name = member.displayName ?? bot?.title ?? member.profile ?? member.memberId;
            const pick = canPick && handleOf(member.memberId) ? () => pickMember(member.memberId) : undefined;
            return (
              <span
                key={member.memberId}
                className={`room-pill${shown ? ` ${shown}` : ""}${pick ? " pickable" : ""}`}
                role={pick ? "button" : undefined}
                tabIndex={pick ? 0 : undefined}
                title={pick ? t("Mention {name}", { name }) : undefined}
                onClick={pick}
                onKeyDown={pick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()) : undefined}
              >
                {bot ? <BotAvatar bot={bot} size={16} /> : peerLook(member.memberId) ? <LookFace look={peerLook(member.memberId)} name={name} size={16} /> : null}
                <span className="room-pill-name">{name}</span>
                {member.owner ? (
                  <span className="room-pill-owner">
                    {lookOf(member.owner) ? <LookFace look={lookOf(member.owner)} name={member.owner} size={12} /> : null}
                    {member.owner}
                  </span>
                ) : null}
                {member.out ? <span className="room-pill-status">· {outLine(member.out)}</span> : null}
                {member.memberId === lead ? (
                  <span className="room-pill-crown" title={t("Lead")} aria-label={t("Lead")}>
                    ♛
                  </span>
                ) : null}
                {shown ? <span className="room-pill-status">{memberStatusLabel(shown)}</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}
      {asking ? (
        <div className="shortcuts-backdrop" onClick={() => !chatOpening && setAsking(false)}>
          <div className="shortcuts-sheet link-sheet room-chat-sheet" role="dialog" aria-modal="true" aria-label={t("Ask Your Agent")} onClick={(e) => e.stopPropagation()}>
            <header>
              <span />
              <h2>{t("Ask Your Agent")}</h2>
              <button type="button" className="link" onClick={() => setAsking(false)} disabled={!!chatOpening}>
                {t("Done")}
              </button>
            </header>
            {chatError ? <p className="error-text">{chatError}</p> : null}
            {chatAgents.map((agent) => (
              <div key={agent.profile} className="room-chat-agent">
                <button className="secondary" disabled={!!chatOpening} onClick={() => void openChat(agent, false)}>
                  {chatOpening === `${agent.profile}|false` ? t("Working…") : askLine(agent.name)}
                </button>
                <button className="secondary" disabled={!!chatOpening} onClick={() => void openChat(agent, true)}>
                  {chatOpening === `${agent.profile}|true` ? t("Working…") : wrapUpLine(agent.name)}
                </button>
              </div>
            ))}
            <p className="meta">
              {t("Opens a private chat with your agent about this room. Nothing you write there goes to the room. An agent that only listens leaves you notes there when the room goes quiet.")}
            </p>
          </div>
        </div>
      ) : null}
      {peopleOpen && people ? (
        <RoomPeopleSheet
          room={room}
          copy={copy ?? null}
          nameOf={(member) => member.displayName ?? memberBot(member.memberId)?.title ?? member.profile ?? member.memberId}
          canSetChoices={people.canSetChoices}
          freeBusy={people.freeBusy}
          canLeave={people.canLeave}
          onChanged={() => {
            setPeopleRead((n) => n + 1);
            people.onChanged();
          }}
          onClose={() => setPeopleOpen(false)}
        />
      ) : null}
      {settingsOpen && status.context ? (
        <RoomSettings
          room={room}
          context={status.context}
          modes={routingChoices(status)}
          mainBot={bots.find((bot) => bot.isDefault)?.title ?? "Hermes"}
          onSave={saveContext}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <div
        className="transcript"
        ref={scroller}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = atEnd(el);
        }}
      >
        <div className="transcript-inner">
          {loading ? <div className="notice">{t('Loading…')}</div> : null}
          {error ? <div className="notice error">{error}</div> : null}
          {copy ? (
            isOver(copy) ? <div className="notice">{`${copyHost(copy)} · ${copyLine(copy)}`}</div> : null
          ) : status.disbanded ? (
            <div className="notice">{t('This group chat was disbanded.')}</div>
          ) : null}
          {!loading && !error && items.length === 0 && pending.length === 0 ? (
            <div className="welcome">
              <h2>{room.name}</h2>
              <span>
                {copy && !copyTakesPosts ? copyReadOnly(copy) : t('Everyone here reads what you send. Mention a bot with @ to ask just them.')}
              </span>
            </div>
          ) : null}
          {items.map((item, i) => {
            const at = item.kind === "note" ? undefined : item.at;
            const before = items
              .slice(0, i)
              .reverse()
              .find((x) => x.kind !== "note" && x.at !== undefined);
            const day =
              startsNewDay(
                before && before.kind !== "note" ? before.at : undefined,
                at,
              ) && at !== undefined ? (
                <div className="day-line">{dayLabel(at)}</div>
              ) : null;
            return (
              <Fragment key={item.key}>
                {day}
                {item.kind === "user" ? (
                  <div key={item.key} className="user" data-key={item.key}>
                    {replies.get(item.key) ? (
                      <QuotedCard
                        name={replies.get(item.key)!.author}
                        quote={replies.get(item.key)!.quote}
                        onJump={jump(replies.get(item.key)!.quote)}
                      />
                    ) : null}
                    {item.files ? <FileChips files={shownFiles(item.files)} roomId={room.roomId} eventId={item.key} readsStored={readsStoredFiles} /> : null}
                    {ownWords(item).trim() ? <div className="bubble">{ownWords(item)}</div> : null}
                    <span className="time">{clock(item.at)}</span>
                    {ownWords(item).trim() ? (
                      <MessageActions
                        copy={ownWords(item)}
                        menu={[{ label: t('Quote'), onSelect: () => setQuote(quoteRequest({ text: blockquote(ownWords(item)) })) }]}
                      />
                    ) : null}
                  </div>
                ) : item.kind === "person" ? (
                  <div key={item.key} className="room-member room-person" data-key={item.key}>
                    {lookOf(item.name) ? (
                      <LookFace look={lookOf(item.name)} name={item.name} size={30} />
                    ) : (
                      <span className="bot-avatar blank room-person-face" style={{ width: 30, height: 30 }} aria-hidden="true">
                        {item.name.trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="room-member-body">
                      <div className="room-member-name">
                        {item.name}
                        <span className="time">{clock(item.at)}</span>
                      </div>
                      {item.files ? <FileChips files={shownFiles(item.files)} roomId={room.roomId} eventId={item.key} readsStored={readsStoredFiles} /> : null}
                      {ownWords(item).trim() ? (
                        <div className="assistant">
                          <div className="bubble person-bubble">{ownWords(item)}</div>
                          <MessageActions
                            copy={ownWords(item)}
                            menu={[{ label: t('Quote'), onSelect: () => setQuote(quoteRequest({ reply: { author: item.name, text: ownWords(item) } })) }]}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : item.kind === "member" ? (
                  <div key={item.key} className="room-member" data-key={item.key}>
                    {memberBot(item.memberId) && canPick && handleOf(item.memberId) ? (
                      <button
                        className="room-member-face"
                        title={t("Mention {name}", { name: item.name })}
                        aria-label={t("Mention {name}", { name: item.name })}
                        onClick={() => pickMember(item.memberId)}
                      >
                        <BotAvatar bot={memberBot(item.memberId)!} size={30} />
                      </button>
                    ) : memberBot(item.memberId) ? (
                      <BotAvatar bot={memberBot(item.memberId)!} size={30} />
                    ) : peerLook(item.memberId) ? (
                      <LookFace look={peerLook(item.memberId)} name={item.name} size={30} />
                    ) : (
                      <span
                        className="bot-avatar blank"
                        style={{ width: 30, height: 30 }}
                      />
                    )}
                    <div className="room-member-body">
                      <div className="room-member-name">
                        {item.name}
                        <span className="time">{clock(item.at)}</span>
                      </div>
                      <div className="assistant">
                        <PictureProfile.Provider
                          value={room.members.find((m) => m.memberId === item.memberId)?.profile}
                        >
                          <Reply text={item.text} />
                        </PictureProfile.Provider>
                        <MessageActions
                          copy={copyableReply(item.text)}
                          menu={[{ label: t('Quote'), onSelect: () => setQuote(quoteRequest({ reply: { author: item.name, text: item.text } })) }]}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={item.key}
                    className={`notice${item.tone === "error" ? " error" : ""}`}
                  >
                    {item.text}
                    {item.paused && canContinueDiscussions && connected && canContinue(events, item.paused, status.maxContinues) ? (
                      <span className="notice-action">
                        <button
                          className="ask-btn"
                          disabled={continuing === item.paused}
                          onClick={() => {
                            const id = item.paused!;
                            setContinuing(id);
                            setContinueError(null);
                            void continueDiscussion(id)
                              .catch((e) => setContinueError(e instanceof Error ? e.message : String(e)))
                              .finally(() => setContinuing(null));
                          }}
                        >
                          {t("Continue")}
                        </button>
                        {continueError ? <span className="ask-error">{continueError}</span> : null}
                      </span>
                    ) : null}
                  </div>
                )}
              </Fragment>
            );
          })}
          {pending.map((p) => (
            <div
              key={p.eventId}
              className={`user pending${p.failed ? " failed" : ""}`}
            >
              {p.attachments.length ? (
                <FileChips
                  roomId={room.roomId}
                  files={p.attachments.map((a) => ({
                    kind: a.kind,
                    name: a.name,
                    dataUrl: a.kind === "image" ? `data:${a.mime};base64,${a.base64}` : undefined,
                  }))}
                />
              ) : null}
              {parseRoomReply(p.text) ? (
                <QuotedCard name={parseRoomReply(p.text)!.author} quote={parseRoomReply(p.text)!.quote} />
              ) : null}
              {(parseRoomReply(p.text)?.message ?? p.text).trim() ? (
                <div className="bubble">{parseRoomReply(p.text)?.message ?? p.text}</div>
              ) : null}
              {p.failed ? (
                <span className="time">
                  {t('Not sent: {reason}', { reason: p.failed })}{" "}
                  <button
                    className="link"
                    onClick={() => void send(p.text, p.attachments, p.eventId)}
                  >
                    {t('Try again')}
                  </button>
                </span>
              ) : (
                <span className="time">{t('Sending…')}</span>
              )}
            </div>
          ))}
          {copy
            ? copied.outbox.map((o) => {
                const row = postRow(copied.posts[o.eventId], copied.inFlight.has(o.eventId), copy, canPostInCopy);
                return (
                  <div key={o.eventId} className={`user pending${row.state === "sending" ? "" : " failed"}`}>
                    <div className="bubble">{o.text}</div>
                    {row.state === "sending" ? (
                      <span className="time">{t("Sending…")}</span>
                    ) : row.state === "notDelivered" ? (
                      <span className="time">
                        <button className="link" onClick={() => void copied.post(o.text, o.eventId)}>
                          {t("Not delivered — retry")}
                        </button>
                      </span>
                    ) : (
                      <span className="time">
                        {row.why}{" "}
                        {row.state === "refused" && row.retry ? (
                          <button className="link" onClick={() => void copied.post(o.text, o.eventId)}>
                            {t("Retry")}
                          </button>
                        ) : null}{" "}
                        {row.state === "refused" ? (
                          <button
                            className="link"
                            onClick={() => {
                              copied.dismiss(o.eventId);
                              setQuote(quoteRequest({ draft: o.text }));
                            }}
                          >
                            {t("Edit")}
                          </button>
                        ) : (
                          <>
                            <button className="link" onClick={() => void navigator.clipboard.writeText(o.text)}>
                              {t("Copy")}
                            </button>{" "}
                            <button className="link" onClick={() => copied.dismiss(o.eventId)}>
                              {t("Dismiss")}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                );
              })
            : null}
          {status.working ? (
            <div className="status-line">
              <span className="running" />
              {busyNames.length
                ? busyNames.length === 1
                  ? t('{name} is answering…', { name: busyNames[0]! })
                  : t('{names} are answering…', { names: busyNames.join(', ') })
                : t('Working…')}
            </div>
          ) : null}
        </div>
        <JumpToLatest scroller={scroller} onJump={() => (pinned.current = true)} />
      </div>
      <div className="room-confirms">
          {deleting === "asking" || deleting === "deleting" ? (
            <div className="notice room-confirm">
              <strong>{t("Delete this room?")}</strong>{" "}
              {t("Your copy of it and your agents' chats for it are deleted from your Hermes. The others keep theirs.")}
              <span className="notice-action">
                <button
                  className="ask-btn danger"
                  disabled={deleting === "deleting"}
                  onClick={() => {
                    setDeleting("deleting");
                    void onDeleteCopy?.()
                      .catch((e) => setDeleteError(t("Could not delete this room: {reason}", { reason: e instanceof Error ? e.message : String(e) })))
                      .finally(() => setDeleting(null));
                  }}
                >
                  {t("Delete")}
                </button>
                <button className="ask-btn" disabled={deleting === "deleting"} onClick={() => setDeleting(null)}>
                  {t("Cancel")}
                </button>
              </span>
            </div>
          ) : null}
          {deleteError ? <div className="notice error">{deleteError}</div> : null}
          {copy && (leaving === "asking" || leaving === "leaving") ? (
            <div className="notice room-confirm">
              <strong>{t("Leave this room?")}</strong> {leaveMessage(copy)}
              <span className="notice-action">
                <button
                  className="ask-btn danger"
                  disabled={leaving === "leaving"}
                  onClick={() => {
                    setLeaving("leaving");
                    void onLeaveCopy?.()
                      .then((kind) => setLeaveNote(kind === "sending" ? { text: t("Your Hermes is still sending this. The room shows it once it has.") } : null))
                      .catch((e) =>
                        setLeaveNote({ text: t("Could not leave this room: {reason}", { reason: e instanceof Error ? e.message : String(e) }), error: true }),
                      )
                      .finally(() => setLeaving(null));
                  }}
                >
                  {t("Leave Room")}
                </button>
                <button className="ask-btn" disabled={leaving === "leaving"} onClick={() => setLeaving(null)}>
                  {t("Cancel")}
                </button>
              </span>
            </div>
          ) : null}
          {leaveNote ? <div className={`notice${leaveNote.error ? " error" : ""}`}>{leaveNote.text}</div> : null}
      </div>
      {copy && copyApprovals.length ? (
        <div className="room-approvals">
          {copyApprovals.map((approval) => (
            <RoomApprovalCard
              key={approval.id}
              approval={approval}
              name={room.members.find((m) => !m.peer && m.profile === approval.agentProfile)?.displayName ?? approvalLine(approval)}
              answer={copyAnswers[approval.id]}
              canAnswer={connected && !!onAnswerCopyApproval}
              onAnswer={(choice) => onAnswerCopyApproval?.(approval, choice)}
            />
          ))}
        </div>
      ) : null}
      {!copy && approvals.length ? (
        <div className="room-approvals">
          {approvals.map((approval) => (
            <RoomApprovalCard
              key={approval.id}
              approval={approval}
              name={room.members.find((m) => m.memberId === approval.memberId || m.profile === approval.memberId)?.displayName ?? memberBot(approval.memberId)?.title ?? (approval.memberId || t("A member"))}
              answer={answers[approval.id]}
              canAnswer={!!canApprove && connected && !status.disbanded}
              onAnswer={(choice) => void approve(approval, choice)}
            />
          ))}
        </div>
      ) : null}
      {canPick && pickable.length ? (
        <div className="room-to" role="group" aria-label={t("To")} title={t("Only the bots you pick answer. With none picked, every bot can answer.")}>
          <span className="room-to-label" aria-hidden="true">
            {t("To")}
          </span>
          {pickable.map((member) => {
            const handle = member.handle!.trim();
            const bot = memberBot(member.memberId);
            const on = isPicked(handle);
            return (
              <button key={member.memberId} className={`room-to-chip${on ? " picked" : ""}`} aria-pressed={on} onClick={() => toggle(handle)}>
                {bot ? <BotAvatar bot={bot} size={18} /> : peerLook(member.memberId) ? <LookFace look={peerLook(member.memberId)} name={member.displayName ?? handle} size={18} /> : null}
                <span>{member.displayName ?? bot?.title ?? member.profile ?? handle}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {copy && !copyTakesPosts ? (
        <div className="room-read-only" role="note">
          <Icon name="eye" />
          <span>{copyReadOnly(copy)}</span>
        </div>
      ) : (
      <Composer
        placeholder={t('Message {name}…', { name: room.name })}
        running={!copy && canStop && status.working}
        disabled={!connected || status.disbanded}
        onSend={(text, attachments) => {
          // In a room someone else hosts, your Hermes posts it there, named for you.
          if (copy) void copied.post(text);
          else void send(text, attachments);
          if (picked.length) setRecipients([]);
        }}
        onStop={() => void stop()}
        focusKey={room.roomId}
        canAttach={!copy && (room.linked ? storesFiles : canAttach)}
        dropZone={pane}
        checkAttachments={room.linked ? linkedRoomFilesProblem : roomUploadProblem}
        quote={quote}
        wrapReply={(reply, draft) => roomReplyText(reply.text, reply.author, draft)}
        address={(draft) => addressing(draft, picked, room.members)}
      />
      )}
    </main>
  );
}
