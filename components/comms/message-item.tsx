"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Copy,
  MessageSquareReply,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
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
export function MessageItem({
  message: m,
  grouped,
  names,
  meId,
  canAct,
  canDelete,
  actions,
  highlight = false,
  bubble = null,
}: {
  message: CommMessage;
  grouped: boolean;
  names: Map<string, string | null>;
  meId: string;
  /** Active member: may react, pin, reply. */
  canAct: boolean;
  canDelete: boolean;
  actions: MessageActions;
  /** 0762: the message a search result or saved item opened — flashed once. */
  highlight?: boolean;
  /** Draw as a chat bubble (Pulse's direct and group chats); null = a channel row. */
  bubble?: "direct" | "group" | null;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLSpanElement | null>(null);

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

  const menuItems: DropdownItem[] =
    deleted || editing
      ? []
      : [
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
          ...(mine && canAct && actions.onEdit && !card ? [{ label: "Edit", icon: Pencil, onClick: () => setEditing(true) }] : []),
          ...(canDelete && actions.onDelete
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
          "has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100",
          reacting && "opacity-100",
        )}
      >
        <DropdownMenu
          label="Message actions"
          trigger={<ChevronDown className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />}
          triggerClassName="inline-flex h-[18px] w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          items={menuItems}
          menuWidth={200}
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
    !!bubble && !deleted && !editing && !card && !!m.body && m.attachments.length === 0 && m.reactions.length === 0 && m.reply_count === 0;
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
        {menu}
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
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            const ok = await actions.onEdit!(m, body);
            if (ok) setEditing(false);
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
        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
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
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  r.mine ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-foreground",
                  canAct && "hover:border-primary",
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                <span className="tabular-nums" aria-hidden>
                  {r.count}
                </span>
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
        id={`msg-${m.id}`}
        className={cn(
          "group relative flex scroll-mt-16 items-end gap-2 px-3",
          // 2px between one person's messages, 12px when the sender changes.
          grouped ? "pt-0.5" : "pt-3",
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
                className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold", AVATAR_TINT)}
              >
                {initials(author)}
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
            "relative min-w-0 max-w-[min(65%,32.5rem)] rounded-xl pb-2 pl-2.5 pr-2 pt-1.5 [&_.text-sm]:text-[14.2px] [&_.text-sm]:leading-[19px]",
            // A sticker is drawn without a bubble, as WhatsApp does.
            sticker
              ? "bg-transparent px-0 shadow-none [&_.text-muted-foreground]:text-muted-foreground"
              : mine
              ? "border border-[color-mix(in_srgb,var(--primary)_28%,var(--surface))] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[color-mix(in_srgb,var(--primary)_35%,var(--foreground))] shadow-[0_1px_2px_rgba(13,15,19,.06)] [&_.text-foreground]:text-[color-mix(in_srgb,var(--primary)_35%,var(--foreground))] [&_.text-muted-foreground]:text-[color-mix(in_srgb,var(--primary)_55%,var(--muted-foreground))]"
              : "border border-border bg-surface shadow-[0_1px_2px_rgba(13,15,19,.06)]",
            // The first bubble of a run points at its sender.
            !sticker && !grouped && (mine ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
          )}
        >
          {showWho && !grouped && (
            <p style={avatarStyle(author)} className="mb-0.5 text-xs font-bold text-[var(--ink)]">
              {author}
            </p>
          )}
          {content}
          {!timeInText && <p className="mt-0.5 flex justify-end">{metaLine(false)}</p>}
        </div>
      </div>
    );
  }

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        "group relative flex scroll-mt-16 gap-3 rounded-md px-3 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60",
        grouped ? "py-0.5" : "pt-2 pb-0.5",
        highlight && "bg-warning-soft ring-2 ring-warning/60 transition-colors",
      )}
    >
      <div className="w-8 shrink-0">
        {!grouped && (
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
          >
            {initials(author)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">{author}</span>
            <time dateTime={m.created_at} className="text-xs text-muted-foreground">
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

      {menu && <div className="shrink-0 pt-1">{menu}</div>}
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
