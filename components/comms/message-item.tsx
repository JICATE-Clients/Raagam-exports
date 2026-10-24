"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Bookmark,
  BookmarkCheck,
  MessageSquareReply,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_MAX, mentionToken, type CommAttachment, type CommMessage } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { MessageBody, clockTime, fileSize, initials } from "./message-body";

export const QUICK_REACTIONS = ["👍", "✅", "👀", "🙏", "😂", "❤️"] as const;

export type MessageActions = {
  onReply?: (m: CommMessage) => void;
  onReact?: (m: CommMessage, emoji: string) => void;
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
}: {
  message: CommMessage;
  grouped: boolean;
  names: Map<string, string | null>;
  meId: string;
  /** Active member: may react, pin, reply. */
  canAct: boolean;
  canDelete: boolean;
  actions: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const [reacting, setReacting] = useState(false);
  const mine = m.author_id === meId;
  const deleted = !!m.deleted_at;
  const author = m.author_name ?? (m.author_id ? "Former user" : "System");

  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-md px-3 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60",
        grouped ? "py-0.5" : "pt-2 pb-0.5",
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
          </>
        )}

        {!deleted && m.attachments.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => actions.onOpenFile(a)}
                  className="flex max-w-[18rem] items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-xs hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 break-all font-medium text-foreground">{a.file_name}</span>
                  <span className="shrink-0 text-muted-foreground">{fileSize(a.size_bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!deleted && m.reactions.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
            {m.reactions.map((r) => (
              <li key={r.emoji}>
                {/* button-shape: exempt -- a reaction chip: one emoji you toggle on or off, a pill not a worded button; there is no group of choices for ToggleGroup to hold */}
                <button
                  type="button"
                  disabled={!canAct || !actions.onReact}
                  onClick={() => actions.onReact?.(m, r.emoji)}
                  aria-pressed={r.mine}
                  aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                    r.mine ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-foreground",
                    canAct && "hover:border-primary",
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.count}</span>
                </button>
              </li>
            ))}
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
              <IconAction label="Add reaction" onClick={() => setReacting((v) => !v)}>
                <SmilePlus className="h-4 w-4" />
              </IconAction>
              {reacting && (
                <div
                  role="menu"
                  aria-label="Pick a reaction"
                  className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
                  onKeyDown={(e) => e.key === "Escape" && setReacting(false)}
                >
                  {QUICK_REACTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="menuitem"
                      aria-label={`React ${e}`}
                      onClick={() => {
                        setReacting(false);
                        actions.onReact!(m, e);
                      }}
                      className="rounded p-1 text-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canAct && actions.onReply && !m.parent_id && (
            <IconAction label="Reply in thread" onClick={() => actions.onReply!(m)}>
              <MessageSquareReply className="h-4 w-4" />
            </IconAction>
          )}
          {actions.onSave && (
            <IconAction label={m.saved ? "Remove from saved" : "Save message"} onClick={() => actions.onSave!(m)}>
              {m.saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
            </IconAction>
          )}
          {canAct && actions.onPin && (
            <IconAction label={m.pinned ? "Unpin" : "Pin to conversation"} onClick={() => actions.onPin!(m)}>
              {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
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
