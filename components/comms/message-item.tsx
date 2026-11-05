"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  MessageSquareReply,
  Pencil,
  Pin,
  PinOff,
  Smile,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useModalGuard } from "@/lib/reload-guard";
import { PhotoImg, useUserPhoto } from "./person-photo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { MESSAGE_MAX, mentionToken, plainText, type CommAttachment, type CommMessage } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { MessageBody, clockTime, initials } from "./message-body";
import { AVATAR_TINT, avatarStyle } from "./conversation-list";
import { EmojiPicker } from "./emoji-picker";
import { MessageAttachments } from "./message-attachments";
import { ContactCard, EventCard, PollCard } from "./message-cards";
import { cardKind, contactOf } from "@/lib/comms/cards";
import { emojiName } from "@/lib/comms/emoji";
import { reactorNames } from "@/lib/comms/reactions";

export type MessageActions = {
  onReply?: (m: CommMessage) => void;
  /** Set the caller's `emoji` on this message to `on` (0760 — a set, not a flip). */
  onReact?: (m: CommMessage, emoji: string, on: boolean) => void;
  onSave?: (m: CommMessage) => void;
  onPin?: (m: CommMessage) => void;
  onEdit?: (m: CommMessage, body: string) => Promise<boolean>;
  onDelete?: (m: CommMessage) => void;
  onOpenFile: (a: CommAttachment) => void;
  /** 0776: a poll / event the server just re-read (a vote, an answer) replaces the one on screen. */
  onReplace?: (m: CommMessage) => void;
};

/**
 * One message row. Grouped under the previous one (no avatar / name line) when
 * the same person wrote it within five minutes — the shape every team chat
 * uses, and what keeps a back-and-forth readable.
 *
 * ACTIONS LIVE IN A ⌄ MENU, WHATSAPP'S WAY (user 2026-11-02, screenshots
 * 151645 / 151550 / 152635: "remove this message mouse hover … give dropdown").
 * The seven-icon bar that floated over the message above is gone. A small V
 * sits after the time inside the bubble (top-right of a channel row) and opens
 * Reply · Copy · React · Pin · Save · Edit · Delete. Its space is ALWAYS kept
 * and only its opacity changes on hover or focus, so nothing in the chat moves
 * as the mouse passes over ("keep the chat fixed in place"). On a touch screen
 * there is no hover, so it is always shown.
 */
/** WhatsApp's six quick reactions; the ＋ opens the full list. All six are in ALLOWED_EMOJI. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function MessageItem({
  message: m,
  grouped,
  names,
  meId,
  canAct,
  actions,
  highlight = false,
  bubble = null,
  seen = false,
  quickEdit = false,
  editRequest = 0,
  onEditDone,
}: {
  message: CommMessage;
  grouped: boolean;
  names: Map<string, string | null>;
  meId: string;
  /** Active member: may react, pin, reply. */
  canAct: boolean;
  actions: MessageActions;
  /** 0762: the message a search result or saved item opened — flashed once. */
  highlight?: boolean;
  /** Draw as a chat bubble (Pulse's direct and group chats); null = a channel row. */
  bubble?: "direct" | "group" | null;
  /** On a message the viewer sent: every other member has read it (two blue ticks). */
  seen?: boolean;
  /** THE THREAD'S EDIT (user 2026-11-05, the "Edit and Delete in a thread"
   *  artifact): a ✎ beside the time on the viewer's own message (shown on
   *  hover, like the ⌄), and "Edit message" first in the ⌄ menu. */
  quickEdit?: boolean;
  /** Bump to open this message's edit box from outside (↑ in an empty box). */
  editRequest?: number;
  /** The edit box closed — saved or cancelled — so the caller can put the
   *  cursor back in its own box. */
  onEditDone?: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // A new `editRequest` opens the box. Adjusted during render (React's
  // "storing information from previous renders"), not in an effect.
  const [seenRequest, setSeenRequest] = useState(editRequest);
  if (editRequest !== seenRequest) {
    setSeenRequest(editRequest);
    if (editRequest > 0) setEditing(true);
  }
  const [reacting, setReacting] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLSpanElement | null>(null);
  // WhatsApp's smiley beside the bubble on hover: its own picker, anchored to it.
  const authorPhoto = useUserPhoto(m.author_id);
  const [hoverReact, setHoverReact] = useState<HTMLButtonElement | null>(null);
  // The quick bar (👍 ❤️ 😂 😮 😢 🙏 ＋) the smiley opens, WhatsApp-style.
  const [quick, setQuick] = useState(false);
  // PHONE: press and hold a bubble → a sheet with the quick bar and the actions
  // (user 2026-11-03, the mobile reactions artifact). There is no hover on touch.
  const [sheet, setSheet] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = useRef(false);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  // PHONE TAP (user 2026-11-04, the Pulse hover-react board): a short tap on a
  // bubble shows its ⌄ and smiley, the touch stand-in for hover; a tap anywhere
  // else hides them again. Press and hold still opens the sheet.
  const [tapped, setTapped] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tapped) return;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setTapped(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [tapped]);
  useModalGuard(sheet);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  // The text as the reader sees it — @Name, never the <@uuid> token.
  function copy() {
    const text = plainText(m.body, names);
    if (!navigator.clipboard) {
      toast.error("Copying is not available in this browser.");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success("Message copied."),
      () => toast.error("The message could not be copied."),
    );
  }
  const mine = m.author_id === meId;
  const deleted = !!m.deleted_at;
  // 0776 — the 📎 cards (lib/comms/cards.ts). A card is never edited as text.
  const card = deleted ? null : cardKind(m.body);
  const contact = card === "contact" ? contactOf(m.body) : null;
  const sticker = card === "sticker";
  const author = m.author_name ?? (m.author_id ? "Former user" : "System");

  const canEdit = mine && canAct && !!actions.onEdit && !card && !deleted;
  const menuItems: DropdownItem[] =
    deleted || editing
      ? []
      : [
          ...(quickEdit && canEdit ? [{ label: "Edit message", icon: Pencil, onClick: () => setEditing(true) }] : []),
          ...(canAct && actions.onReply && !m.parent_id
            ? [{ label: "Reply in thread", icon: MessageSquareReply, onClick: () => actions.onReply!(m) }]
            : []),
          ...(m.body ? [{ label: "Copy", icon: Copy, onClick: copy }] : []),
          ...(canAct && actions.onReact ? [{ label: "React", icon: SmilePlus, onClick: () => setReacting(true) }] : []),
          ...(canAct && actions.onPin
            ? [{ label: m.pinned ? "Unpin" : "Pin", icon: m.pinned ? PinOff : Pin, onClick: () => actions.onPin!(m) }]
            : []),
          ...(actions.onSave
            ? [{ label: m.saved ? "Unsave" : "Save", icon: m.saved ? BookmarkCheck : Bookmark, onClick: () => actions.onSave!(m) }]
            : []),
          ...(!quickEdit && canEdit ? [{ label: "Edit", icon: Pencil, onClick: () => setEditing(true) }] : []),
          // Delete is on EVERY message (user 2026-11-04): anyone may Delete for
          // me; `mayDelete` decides only whether the dialog also offers Delete
          // for everyone (conversation-view.tsx, DeleteMessageDialog).
          ...(actions.onDelete
            ? [{ label: "Delete", icon: Trash2, danger: true, separatorBefore: true, onClick: () => actions.onDelete!(m) }]
            : []),
        ];

  // The ⌄ and, when React is picked, the emoji picker anchored to it.
  const menu =
    menuItems.length === 0 ? null : (
      <span
        ref={setPickerAnchor}
        className={cn(
          "inline-flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
          // A channel row keeps its ⌄ always visible on touch; a bubble shows it
          // only once tapped (the touch stand-in for hover).
          "has-[[aria-expanded=true]]:opacity-100",
          bubble ? tapped && "opacity-100" : "[@media(hover:none)]:opacity-100",
          reacting && "opacity-100",
        )}
      >
        <DropdownMenu
          label="Message actions"
          trigger={<ChevronDown className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />}
          triggerClassName="inline-flex h-[18px] w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          items={menuItems}
          // Compact (user 2026-11-04, the Pulse compact-popups board).
          compact
          menuWidth={156}
        />
        {reacting && actions.onReact && (
          <EmojiPicker
            anchor={pickerAnchor?.querySelector("button") ?? null}
            onClose={() => setReacting(false)}
            onPick={(e) => {
              setReacting(false);
              // Picking an emoji you already wear is a no-op, not a removal:
              // the picker ADDS; the chip is what toggles.
              actions.onReact!(m, e, true);
            }}
          />
        )}
      </span>
    );

  // WHATSAPP'S TIME LINE (user 2026-11-02, screenshot 153534): pin, saved,
  // Edited, the time and the ⌄. In a plain text bubble it floats at the end of
  // the last line, so a short message is one slim line; anything that follows
  // the text (files, reactions, a poll) puts it on its own line at the bottom.
  const timeInText =
    !!bubble && !deleted && !editing && !card && !!m.body && m.attachments.length === 0 && m.reply_count === 0;
  function metaLine(inText: boolean) {
    return (
      <span
        className={cn(
          "inline-flex h-[15px] items-center gap-1 whitespace-nowrap text-[11px] leading-[15px] text-muted-foreground",
          inText && "relative top-[5px] float-right -mb-[5px] ml-2.5",
        )}
      >
        {m.pinned && <Pin className="h-3 w-3" aria-label="Pinned" />}
        {m.saved && <BookmarkCheck className="h-3 w-3" aria-label="Saved" />}
        {m.edited_at && <span>Edited</span>}
        <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
        {/* WhatsApp's ticks, on messages I sent: one grey = sent, two blue = everyone has read it. */}
        {bubble && mine && !deleted && (
          seen ? (
            <CheckCheck className="h-[14px] w-[14px] text-[#34a7e0]" aria-label="Seen" />
          ) : (
            <Check className="h-[14px] w-[14px]" aria-label="Sent" />
          )
        )}
        {/* THE ⌄ AFTER THE TIME (user 2026-11-04, the Pulse compact-bubbles board):
            a 20px slot that is ALWAYS there, so the ⌄ only fades in on hover and
            nothing in the bubble moves or is covered. */}
        {quickEdit && canEdit && !editing && (
          // button-shape: exempt -- a 20px glyph beside the time, the ⌄'s twin
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit message"
            title="Edit message"
            className={cn(
              "inline-flex h-[18px] w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100",
              bubble ? tapped && "opacity-100" : "[@media(hover:none)]:opacity-100",
            )}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {menu && <span className="inline-flex w-5 shrink-0 justify-center">{menu}</span>}
      </span>
    );
  }

  // The message's own pieces, drawn in both layouts below.
  const content = (
    <>
      {deleted ? (
        <p className="text-sm italic text-muted-foreground">This message was deleted.</p>
      ) : editing && actions.onEdit ? (
        <EditBox
          message={m}
          names={names}
          onCancel={() => {
            setEditing(false);
            onEditDone?.();
          }}
          onSave={async (body) => {
            const ok = await actions.onEdit!(m, body);
            if (ok) {
              setEditing(false);
              onEditDone?.();
            }
            return ok;
          }}
        />
      ) : (
        <>
          {m.poll ? (
            <PollCard message={m} poll={m.poll} canAct={canAct} onReplace={actions.onReplace} />
          ) : m.event ? (
            <EventCard message={m} event={m.event} canAct={canAct} onReplace={actions.onReplace} />
          ) : contact ? (
            <ContactCard contact={contact} meId={meId} />
          ) : sticker ? null : (
            m.body && <MessageBody body={m.body} names={names} meId={meId} trailer={timeInText ? metaLine(true) : undefined} />
          )}
          {/* A bubble shows Edited and Saved beside its time instead (metaLine). */}
          {!bubble && m.edited_at && <span className="text-[11px] text-muted-foreground">(edited)</span>}
          {/* Your own bookmark, always visible — `saved` is read per person (0737), never anyone else's. */}
          {!bubble && m.saved && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
              <BookmarkCheck className="h-3 w-3" aria-hidden /> Saved
            </span>
          )}
        </>
      )}

      {!deleted && m.attachments.length > 0 && (
        <MessageAttachments attachments={m.attachments} onOpenFile={actions.onOpenFile} />
      )}

      {!deleted && m.reactions.length > 0 && (
        <ul
          className={cn(
            bubble ? "absolute -bottom-3.5 z-10 flex gap-0.5" : "mt-1 flex flex-wrap gap-1",
            bubble && (mine ? "right-1.5" : "left-1.5"),
          )}
          aria-label="Reactions"
        >
          {m.reactions.map((r) => {
            const who = reactorNames(r.users, names, meId);
            return (
            <li key={r.emoji}>
              {/* button-shape: exempt -- a reaction chip: one emoji you toggle on or off, a pill not a worded button; there is no group of choices for ToggleGroup to hold */}
              <button
                type="button"
                disabled={!canAct || !actions.onReact}
                onClick={() => actions.onReact?.(m, r.emoji, !r.mine)}
                aria-pressed={r.mine}
                title={`${who} reacted with ${emojiName(r.emoji)}`}
                aria-label={`${emojiName(r.emoji)}, ${r.count} ${r.count === 1 ? "reaction" : "reactions"}: ${who}${r.mine ? ". Press to remove yours" : ""}`}
                className={cn(
                  "flex items-center gap-1 rounded-full border text-xs",
                  // A bubble's chip: 22px, one line, a soft shadow and no thick ring
                  // (user 2026-11-04, the Pulse compact-bubbles board).
                  bubble ? "h-[22px] gap-0.5 whitespace-nowrap px-[5px] text-[13px] leading-none shadow-[0_1px_2px_rgba(11,20,26,.18)]" : "px-2 py-0.5",
                  r.mine ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-foreground",
                  bubble && !r.mine && "border-transparent",
                  canAct && "hover:border-primary",
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                {(!bubble || r.count > 1) && (
                  <span className={cn("tabular-nums", bubble ? "text-[11px] text-muted-foreground" : "text-xs")} aria-hidden>
                    {r.count}
                  </span>
                )}
              </button>
            </li>
            );
          })}
        </ul>
      )}

      {m.reply_count > 0 && actions.onReply && (
        <button
          type="button"
          onClick={() => actions.onReply!(m)}
          className="mt-1 text-xs font-semibold text-primary hover:underline"
        >
          {m.reply_count === 1 ? "1 reply" : `${m.reply_count} replies`}
          {m.last_reply_at && <span className="font-normal text-muted-foreground"> · last {clockTime(m.last_reply_at)}</span>}
        </button>
      )}
    </>
  );

  // BUBBLES (the Pulse redesign, 2026-10-29) for direct and group chats: yours
  // on the right in the primary colour, everyone else's on the left on white,
  // a sender's name in their own colour above a group bubble, the time inside
  // the bubble. Channels keep the classic rows below — a channel is read as a
  // stream, not a back-and-forth. Same pieces, same actions, same tap rule.
  // A system line ("Roja added Yogesh") is nobody's bubble: a centred note.
  if (bubble && m.kind === "system") {
    return (
      <div id={`msg-${m.id}`} className="flex justify-center px-3 py-1">
        <p className="rounded-full bg-surface px-3 py-1 text-center text-xs text-muted-foreground shadow-sm">{plainText(m.body, names)}</p>
      </div>
    );
  }

  if (bubble) {
    const showWho = bubble === "group" && !mine;
    return (
      <div
        ref={rowRef}
        id={`msg-${m.id}`}
        className={cn(
          "group relative flex scroll-mt-16 items-end gap-2 px-3",
          // 2px between one person's messages, 12px when the sender changes.
          grouped ? "pt-0.5" : "pt-3",
          !deleted && m.reactions.length > 0 && "pb-3.5",
          mine ? "justify-end" : "justify-start",
          highlight && "rounded-md bg-warning-soft ring-2 ring-warning/60 transition-colors",
        )}
      >
        {showWho && (
          <div className="w-8 shrink-0">
            {!grouped && (
              <span
                aria-hidden
                style={avatarStyle(author)}
                className={cn("flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold", AVATAR_TINT)}
              >
                {authorPhoto ? <PhotoImg src={authorPhoto} /> : initials(author)}
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            // WhatsApp's sizes (screenshot 153534: 14.2px text on a 19px line,
            // padding 6 / 8 / 8 / 10) in the THEME's colour (user 2026-11-02):
            // yours is --primary mixed 14% into the surface (28% for the border,
            // the text deepened from it), so it changes with the topbar colour
            // menu, light and dark; theirs white with a hairline border. 12px
            // corners with a 4px one on the sender's side.
            "relative min-w-0 max-w-[min(65%,32.5rem)] rounded-xl pb-2 pl-2.5 pr-2 pt-1.5 [&_.text-sm]:text-[14.2px] [&_.text-sm]:leading-[19px] [@media(hover:none)]:select-none",
            // A sticker is drawn without a bubble, as WhatsApp does.
            sticker
              ? "bg-transparent px-0 shadow-none [&_.text-muted-foreground]:text-muted-foreground"
              : mine
              ? // SOFT PEACH SANDAL (user 2026-11-04, the Pulse bubble-colour
                // board): a sent bubble is #FFF8F1 with a #F3E3D3 hairline in the
                // light theme, whatever the topbar colour; replies stay white.
                // Dark keeps the theme-colour mix above, since a near-white
                // bubble would glare on the dark wall.
                "border border-[#f3e3d3] bg-[#fff8f1] text-foreground shadow-[0_1px_2px_rgba(13,15,19,.06)] dark:border-[color-mix(in_srgb,var(--primary)_28%,var(--surface))] dark:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] dark:text-[color-mix(in_srgb,var(--primary)_35%,var(--foreground))] dark:[&_.text-foreground]:text-[color-mix(in_srgb,var(--primary)_35%,var(--foreground))] dark:[&_.text-muted-foreground]:text-[color-mix(in_srgb,var(--primary)_55%,var(--muted-foreground))]"
              : "border border-border bg-surface shadow-[0_1px_2px_rgba(13,15,19,.06)]",
            // The first bubble of a run points at its sender.
            !sticker && !grouped && (mine ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
          )}
          onPointerDown={(e) => {
            if (e.pointerType !== "touch" || !canAct || menuItems.length === 0 || deleted || editing) return;
            holdFired.current = false;
            holdStart.current = { x: e.clientX, y: e.clientY };
            holdTimer.current = setTimeout(() => {
              holdFired.current = true;
              setSheet(true);
            }, 400);
          }}
          onPointerUp={(e) => {
            if (holdTimer.current) clearTimeout(holdTimer.current);
            // A short tap (the hold never fired) shows the ⌄ and smiley.
            if (e.pointerType === "touch" && holdTimer.current && !holdFired.current) setTapped((v) => !v);
            holdTimer.current = null;
          }}
          onPointerCancel={() => {
            if (holdTimer.current) clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }}
          onPointerMove={(e) => {
            // A scroll is not a tap or a hold; a finger's few-pixel wobble is.
            const s = holdStart.current;
            if (!holdTimer.current || !s || Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return;
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }}
          onContextMenu={(e) => {
            if (sheet || holdTimer.current) e.preventDefault();
          }}
        >
          {showWho && !grouped && (
            <p style={avatarStyle(author)} className="mb-0.5 text-xs font-bold text-[var(--ink)]">
              {author}
            </p>
          )}
          {content}
          {!timeInText && <p className="mt-0.5 flex justify-end">{metaLine(false)}</p>}
        </div>
        {canAct && actions.onReact && !deleted && !editing && !sticker && (
          <>
            {/* button-shape: exempt -- WhatsApp's round hover smiley beside a bubble (user 2026-11-03), an icon chip rather than an action button.
                THE CLIENT'S ICON (2026-11-04, screenshot 122815): a 32px white circle, a plain grey smiley, no border; on a phone it shows once the bubble is tapped. */}
            <button
              type="button"
              aria-label="React"
              title="React"
              onClick={() => setQuick((o) => !o)}
              aria-expanded={quick}
              className={cn(
                "mb-1 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full bg-surface/85 text-[#8696a0] shadow-[0_1px_2px_rgba(11,20,26,.12)] transition-opacity hover:text-[#54656f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground",
                mine ? "order-first" : "order-last",
                quick || hoverReact || tapped ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
              )}
            >
              <Smile className="h-[19px] w-[19px]" strokeWidth={1.6} aria-hidden />
            </button>
            {quick && (
              <div
                role="menu"
                aria-label="Quick reactions"
                className={cn(
                  "absolute bottom-full z-30 mb-1 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-1 shadow-lg",
                  mine ? "right-3" : "left-11",
                )}
                onMouseLeave={() => !hoverReact && setQuick(false)}
              >
                {QUICK_REACTIONS.map((e) => {
                  const wearing = m.reactions.some((r) => r.emoji === e && r.mine);
                  return (
                    // button-shape: exempt -- one emoji in WhatsApp's quick-reaction bar (user 2026-11-03), a glyph in a circle
                    <button
                      key={e}
                      type="button"
                      role="menuitem"
                      aria-label={`${wearing ? "Remove" : "React with"} ${emojiName(e)}`}
                      onClick={() => {
                        setQuick(false);
                        actions.onReact!(m, e, !wearing);
                      }}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full text-[22px] transition-transform hover:-translate-y-0.5 hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        wearing && "bg-primary-soft",
                      )}
                    >
                      {e}
                    </button>
                  );
                })}
                {/* button-shape: exempt -- the ＋ that opens the full emoji list from the quick bar */}
                <button
                  type="button"
                  aria-label="More emoji"
                  title="More emoji"
                  onClick={(ev) => {
                    const btn = ev.currentTarget;
                    setHoverReact((cur) => (cur ? null : btn));
                  }}
                  className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  +
                </button>
              </div>
            )}
            {sheet && (
              <div
                className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/45 px-4"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSheet(false);
                }}
              >
                <div role="menu" aria-label="Quick reactions" className="flex items-center rounded-full bg-surface px-1.5 py-1 shadow-xl">
                  {QUICK_REACTIONS.map((e) => {
                    const wearing = m.reactions.some((r) => r.emoji === e && r.mine);
                    return (
                      // button-shape: exempt -- one emoji in the phone's quick-reaction sheet, a glyph in a circle
                      <button
                        key={e}
                        type="button"
                        role="menuitem"
                        aria-label={`${wearing ? "Remove" : "React with"} ${emojiName(e)}`}
                        onClick={() => {
                          setSheet(false);
                          actions.onReact?.(m, e, !wearing);
                        }}
                        className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xl active:scale-125", wearing && "bg-primary-soft")}
                      >
                        {e}
                      </button>
                    );
                  })}
                  {/* button-shape: exempt -- the ＋ that opens the full emoji list from the phone sheet */}
                  <button
                    type="button"
                    aria-label="More emoji"
                    onClick={(ev) => {
                      const btn = ev.currentTarget;
                      setHoverReact((cur) => (cur ? null : btn));
                    }}
                    className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-base text-muted-foreground"
                  >
                    +
                  </button>
                </div>
                {m.body && (
                  <p className="max-h-32 max-w-sm overflow-hidden rounded-[10px] bg-surface px-2.5 py-1.5 text-[13.5px] shadow-lg">{plainText(m.body, names)}</p>
                )}
                {/* COMPACT (user 2026-11-04): 38px rows, still a thumb's target. */}
                <ul className="w-44 overflow-hidden rounded-xl bg-surface shadow-xl">
                  {menuItems
                    .filter((it) => it.label !== "React")
                    .map((it) => {
                      const Icon = it.icon;
                      return (
                        <li key={it.label} className="border-b border-border last:border-b-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSheet(false);
                              it.onClick?.();
                            }}
                            className={cn("flex h-[38px] w-full items-center gap-2.5 px-3.5 text-left text-[13.5px]", it.danger ? "text-danger" : "text-foreground")}
                          >
                            {Icon && <Icon className="h-4 w-4" aria-hidden />}
                            {it.label}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}
            {hoverReact && (
              <EmojiPicker
                anchor={hoverReact}
                onClose={() => {
                  setHoverReact(null);
                  setQuick(false);
                  setSheet(false);
                }}
                onPick={(e) => {
                  setHoverReact(null);
                  setQuick(false);
                  setSheet(false);
                  actions.onReact!(m, e, true);
                }}
              />
            )}
          </>
        )}
      </div>
    );
  }

  // CHANNEL ROWS, COMPACT (user 2026-11-04, the Pulse channel-page board): a
  // 30px avatar in the person's own colour (their photo when they have one),
  // a 13px name, 13.5px text and 9px between them. On a laptop React, Reply in
  // thread and the ⌄ float as a small toolbar over the row under the mouse; on
  // a touch screen the ⌄ stays at the row's end, as before.
  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        "group relative flex scroll-mt-16 gap-[9px] px-3 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60 [&_.text-sm]:text-[13.5px] [&_.text-sm]:leading-[1.45]",
        grouped ? "py-px" : "pb-px pt-1.5",
        highlight && "bg-warning-soft ring-2 ring-warning/60 transition-colors",
      )}
    >
      <div className="w-[30px] shrink-0">
        {!grouped && (
          <span
            aria-hidden
            style={avatarStyle(author)}
            className={cn("mt-0.5 flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full text-[11px] font-bold", AVATAR_TINT)}
          >
            {authorPhoto ? <PhotoImg src={authorPhoto} /> : initials(author)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-[7px]">
            <span className="text-[13px] font-bold text-foreground">{author}</span>
            <time dateTime={m.created_at} className="text-[11px] tabular-nums text-muted-foreground">
              {clockTime(m.created_at)}
            </time>
            {m.pinned && (
              <span className="flex items-center gap-0.5 text-xs text-warning">
                <Pin className="h-3 w-3" aria-hidden /> Pinned
              </span>
            )}
          </div>
        )}

        {content}
      </div>

      {menu && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 self-start pt-1",
            "md:absolute md:-top-3 md:right-2 md:z-10 md:rounded-lg md:border md:border-border md:bg-surface md:p-0.5 md:shadow-sm",
            "md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[aria-expanded=true]]:opacity-100",
            reacting && "md:opacity-100",
          )}
        >
          {canAct && actions.onReact && !deleted && !editing && (
            // button-shape: exempt -- an icon square in the row's hover toolbar
            <button
              type="button"
              aria-label="React"
              title="React"
              onClick={() => setReacting(true)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
            >
              <Smile className="h-[15px] w-[15px]" aria-hidden />
            </button>
          )}
          {canAct && actions.onReply && !m.parent_id && !deleted && !editing && (
            // button-shape: exempt -- an icon square in the row's hover toolbar
            <button
              type="button"
              aria-label="Reply in thread"
              title="Reply in thread"
              onClick={() => actions.onReply!(m)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
            >
              <MessageSquareReply className="h-[15px] w-[15px]" aria-hidden />
            </button>
          )}
          <span className="md:flex md:h-[26px] md:w-[26px] md:items-center md:justify-center">{menu}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Inline edit. The stored `<@uuid>` tokens are shown as `@Name` while editing
 * and turned back into tokens on save, so a mention survives an edit without
 * the operator ever seeing an id.
 */
function EditBox({
  message,
  names,
  onSave,
  onCancel,
}: {
  message: CommMessage;
  names: Map<string, string | null>;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const labels = new Map<string, string>(); // "@Name" → id
  const initial = (message.body ?? "").replace(/<@([0-9a-f-]{36})>/gi, (_, id: string) => {
    const label = `@${names.get(id.toLowerCase()) ?? "someone"}`;
    labels.set(label, id.toLowerCase());
    return label;
  });
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    let out = text.trim();
    for (const [label, id] of [...labels].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(label).join(mentionToken(id));
    }
    setBusy(true);
    await onSave(out);
    setBusy(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className="mt-1 space-y-1">
      {/* caps-input: exempt -- a chat message is prose (lib/comms/types.ts) */}
      <Textarea
        uppercase={false}
        autoFocus
        rows={2}
        maxLength={MESSAGE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Edit message"
        className="resize-none"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}
