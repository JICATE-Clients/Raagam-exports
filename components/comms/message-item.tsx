"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  MessageSquareReply,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { MESSAGE_MAX, mentionToken, plainText, type CommAttachment, type CommMessage } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { MessageBody, clockTime, initials } from "./message-body";
import { EmojiPicker } from "./emoji-picker";
import { MessageAttachments } from "./message-attachments";
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
};

/**
 * One message row. Grouped under the previous one (no avatar / name line) when
 * the same person wrote it within five minutes — the shape every team chat
 * uses, and what keeps a back-and-forth readable.
 *
 * The action bar appears on hover or keyboard focus; on a touch screen (no
 * hover) it is always shown, or the actions would be unreachable.
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
  const author = m.author_name ?? (m.author_id ? "Former user" : "System");

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
            {m.body && <MessageBody body={m.body} names={names} meId={meId} />}
            {m.edited_at && <span className="text-[11px] text-muted-foreground">(edited)</span>}
            {/* Your own bookmark, always visible — `saved` is read per person (0737), never anyone else's. */}
            {m.saved && (
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
      </div>

      {!deleted && !editing && (
        <div
          className={cn(
            "absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-sm",
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
            reacting && "opacity-100",
          )}
        >
          {canAct && actions.onReact && (
            <div className="relative">
              <span ref={setPickerAnchor} className="inline-flex">
                <IconAction label="Add reaction" onClick={() => setReacting((v) => !v)}>
                  <SmilePlus className="h-4 w-4" />
                </IconAction>
              </span>
              {reacting && (
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
            </div>
          )}
          {canAct && actions.onReply && !m.parent_id && (
            <IconAction label="Reply in thread" onClick={() => actions.onReply!(m)}>
              <MessageSquareReply className="h-4 w-4" />
            </IconAction>
          )}
          {actions.onSave && (
            <IconAction label={m.saved ? "Remove from saved" : "Save for later"} onClick={() => actions.onSave!(m)}>
              {m.saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
            </IconAction>
          )}
          {canAct && actions.onPin && (
            <IconAction label={m.pinned ? "Unpin" : "Pin to conversation"} onClick={() => actions.onPin!(m)}>
              {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </IconAction>
          )}
          {!!m.body && (
            <IconAction label="Copy text" onClick={copy}>
              <Copy className="h-4 w-4" />
            </IconAction>
          )}
          {mine && canAct && actions.onEdit && (
            <IconAction label="Edit message" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </IconAction>
          )}
          {canDelete && actions.onDelete && (
            <IconAction label="Delete message" onClick={() => actions.onDelete!(m)} danger>
              <Trash2 className="h-4 w-4" />
            </IconAction>
          )}
        </div>
      )}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        danger ? "hover:text-danger" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
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
