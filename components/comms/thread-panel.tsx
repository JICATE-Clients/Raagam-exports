"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteMessage, editMessage, hideMessage, loadThread, markThreadSeen, sendMessage, setReaction, setSaved } from "@/lib/comms/actions";
import { applyReaction } from "@/lib/comms/reactions";
import { cardKind } from "@/lib/comms/cards";
import type { AttachmentInput, CommAttachment, CommMessage, ConversationDetail } from "@/lib/comms/types";
import { Composer } from "./composer";
import { DeleteMessageDialog } from "./delete-message-dialog";
import { MessageItem } from "./message-item";

/**
 * A thread: the first message and its replies, one level deep (0737).
 *
 * Re-read whenever the conversation's doorbell rings (`version`), so a reply
 * someone else posts arrives here too. Replies are sent and then re-read —
 * not optimistic like the main stream — and a failed send keeps the typed text
 * in the box with the reason, so nothing is lost and Send is the retry.
 *
 * A PANEL BESIDE THE CHAT, NOT A POP-UP (user 2026-11-05, screenshots 123746
 * -> 123837 and the "Thread side panel" artifact: "apply"). It was a centred
 * `Sheet` over the conversation with a two-row formatting toolbar and a hint
 * line; it is now docked on the right like Search messages
 * (chat-search-panel.tsx) -- beside the chat on a wide pane, over it on a
 * narrow one -- drawn as bubbles, with the same one-line pill box the chat
 * uses (`Composer chat`). The widen button widens it; X or Esc closes it.
 *
 * The mockup's Following, files and pin buttons are NOT here: Pulse has no
 * thread-follow, per-thread files or thread pin behind them, and a button that
 * does nothing is worse than none. Add each with its feature.
 *
 * Not a modal, so it registers no reload guard of its own; the Composer
 * inside guards a half-typed reply as it does everywhere.
 */
export function ThreadPanel({
  parent,
  version,
  conversation,
  names,
  meId,
  canPost,
  onClose,
  onChanged,
  highlightId = null,
  onOpenFile,
  bubble,
  mayDelete,
}: {
  parent: CommMessage | null;
  version: number;
  conversation: ConversationDetail;
  names: Map<string, string | null>;
  meId: string;
  canPost: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** 0762: a reply opened from search — scrolled to and flashed once. */
  highlightId?: string | null;
  onOpenFile: (a: CommAttachment) => void;
  /** The chat's bubble style; a channel's thread draws as a group chat. */
  bubble: "direct" | "group";
  /** The caller may delete this message for everyone (conversation-view's rule). */
  mayDelete: (m: CommMessage) => boolean;
}) {
  const [wide, setWide] = useState(false);
  // EDIT AND DELETE IN A THREAD (user 2026-11-05, the "Edit and Delete in a
  // thread" artifact: "apply"). The same server actions and the same delete
  // dialog as the chat; only Pin stays in the chat.
  const [confirmDelete, setConfirmDelete] = useState<CommMessage | null>(null);
  const [editReq, setEditReq] = useState<{ id: string; n: number } | null>(null);
  const [thread, setThread] = useState<{ parent: CommMessage; replies: CommMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const parentId = parent?.id ?? null;

  useEffect(() => {
    if (!parentId) return;
    let live = true;
    void loadThread(parentId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setThread({ parent: r.parent, replies: r.replies });
        setError(null);
        // 0811: the list's Threads section stops showing it as new. Every
        // re-read (a reply arriving while it is open) moves the marker on too.
        if (r.parent.reply_count > 0) void markThreadSeen(parentId);
      } else {
        setError(r.error);
      }
    });
    return () => {
      live = false;
    };
  }, [parentId, version, retry]);

  async function reply(body: string | null, attachments: AttachmentInput[]): Promise<boolean> {
    if (!parentId) return false;
    const r = await sendMessage({
      conversation_id: conversation.id,
      client_id: crypto.randomUUID(),
      body,
      parent_id: parentId,
      attachments,
    });
    if (!r.ok) {
      setSendError(r.error);
      return false;
    }
    setSendError(null);
    setRetry((n) => n + 1);
    onChanged();
    return true;
  }

  const shown = thread && thread.parent.id === parentId ? thread : null;
  const [flash, setFlash] = useState<string | null>(highlightId);
  useEffect(() => {
    if (!flash || !shown?.replies.some((m) => m.id === flash)) return;
    document.getElementById(`msg-${flash}`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash, shown]);

  // Reactions in a thread (0760): the same set-then-reconcile as the main
  // list. Edit and Delete are offered too (below); Pin stays in the chat.
  function patch(id: string, fn: (m: CommMessage) => CommMessage) {
    setThread((t) =>
      t ? { parent: t.parent.id === id ? fn(t.parent) : t.parent, replies: t.replies.map((m) => (m.id === id ? fn(m) : m)) } : t,
    );
  }
  async function react(m: CommMessage, emoji: string, on: boolean) {
    const before = m.reactions;
    patch(m.id, (x) => ({ ...x, reactions: applyReaction(x.reactions, emoji, on, meId) }));
    const r = await setReaction(m.id, emoji, on);
    if (!r.ok) {
      patch(m.id, (x) => ({ ...x, reactions: before }));
      setSendError(r.error);
      return;
    }
    if (r.reactions) {
      const truth = r.reactions;
      patch(m.id, (x) => ({ ...x, reactions: truth }));
    }
    onChanged();
  }
  // Save for later works on a thread's parent and every reply (0763) — a
  // bookmark is personal, so anyone who can READ the thread may save from it.
  const saving = useRef(new Set<string>());
  async function save(m: CommMessage) {
    if (saving.current.has(m.id)) return;
    saving.current.add(m.id);
    const want = !m.saved;
    const r = await setSaved(m.id, want);
    saving.current.delete(m.id);
    if (!r.ok) {
      setSendError(r.error);
      return;
    }
    patch(m.id, (x) => ({ ...x, saved: want }));
    onChanged();
  }
  async function edit(m: CommMessage, body: string): Promise<boolean> {
    const r = await editMessage(m.id, body);
    if (!r.ok) {
      setSendError(r.error);
      return false;
    }
    setSendError(null);
    setRetry((n) => n + 1);
    onChanged();
    return true;
  }
  // Delete for everyone: the soft delete every member sees. On the first
  // message the thread stays, its replies under "This message was deleted".
  async function deleteForAll() {
    const m = confirmDelete;
    if (!m) return;
    setConfirmDelete(null);
    const r = await deleteMessage(m.id);
    if (!r.ok) return setSendError(r.error);
    setRetry((n) => n + 1);
    onChanged();
  }
  // Delete for me (0807): gone from this person's view. Hiding the first
  // message hides the thread itself, so the panel closes.
  async function deleteForMe() {
    const m = confirmDelete;
    if (!m) return;
    setConfirmDelete(null);
    const r = await hideMessage(m.id);
    if (!r.ok) return setSendError(r.error);
    onChanged();
    if (m.id === parentId) onClose();
    else setThread((t) => (t ? { ...t, replies: t.replies.filter((x) => x.id !== m.id) } : t));
  }
  // ↑ in an empty Reply box: the caller's newest message in this thread.
  function editLast(): boolean {
    if (!shown) return false;
    const mine = [shown.parent, ...shown.replies]
      .filter((x) => x.author_id === meId && !x.deleted_at && !cardKind(x.body))
      .pop();
    if (!mine) return false;
    setEditReq((r) => ({ id: mine.id, n: (r?.n ?? 0) + 1 }));
    return true;
  }
  function backToReply() {
    document.querySelector<HTMLTextAreaElement>('aside[aria-label="Thread"] textarea[aria-label="Reply in thread"]')?.focus();
  }
  const threadActions = canPost
    ? {
        onOpenFile,
        onSave: (m: CommMessage) => void save(m),
        onReact: (m: CommMessage, e: string, on: boolean) => void react(m, e, on),
        onEdit: edit,
        onDelete: (m: CommMessage) => setConfirmDelete(m),
      }
    : // Delete for me needs no posting rights (0807: anyone who can read).
      { onOpenFile, onSave: (m: CommMessage) => void save(m), onDelete: (m: CommMessage) => setConfirmDelete(m) };
  const editProps = (m: CommMessage) => ({
    quickEdit: true,
    editRequest: editReq?.id === m.id ? editReq.n : 0,
    onEditDone: backToReply,
  });

  if (!parent) return null;

  // Esc closes the panel -- unless something inside (the emoji picker, the 📎
  // menu, an @-mention list) already took it, which each marks with
  // preventDefault. Marking it here too stops the page-level Esc going back.
  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }

  const count = shown?.replies.length ?? 0;
  const countLabel = `${count} ${count === 1 ? "reply" : "replies"}`;
  const iconBtn =
    "rounded-full p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <aside
      aria-label="Thread"
      onKeyDown={onKey}
      className={cn(
        "absolute inset-0 z-20 flex min-h-0 flex-col bg-[color-mix(in_srgb,var(--primary)_4%,var(--surface))]",
        "@5xl/comms:relative @5xl/comms:shrink-0 @5xl/comms:border-l @5xl/comms:border-border @5xl/comms:transition-[width]",
        wide ? "@5xl/comms:w-[38rem]" : "@5xl/comms:w-[25rem]",
      )}
    >
      <header className="flex items-center gap-2 px-4 py-2.5">
        <h2 className="text-xl font-normal text-heading">Thread</h2>
        {shown && count > 0 && (
          <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{countLabel}</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setWide((w) => !w)}
          aria-label={wide ? "Narrow the thread" : "Widen the thread"}
          title={wide ? "Narrow" : "Widen"}
          // Below the docking width the panel already fills the pane.
          className={cn(iconBtn, "hidden @5xl/comms:inline-flex")}
        >
          {wide ? <Minimize2 className="h-[18px] w-[18px]" aria-hidden /> : <Maximize2 className="h-[18px] w-[18px]" aria-hidden />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close thread" title="Close thread (Esc)" className={iconBtn}>
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error ? (
          <p className="flex items-center gap-2 p-3 text-sm text-danger" role="alert">
            {error}
            <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        ) : !shown ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the thread…
          </p>
        ) : (
          <>
            <MessageItem
              message={shown.parent}
              bubble={bubble}
              grouped={false}
              names={names}
              meId={meId}
              canAct={canPost}
              actions={threadActions}
              {...editProps(shown.parent)}
            />
            <div className="my-2 flex items-center gap-3 px-4" role="separator">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-semibold text-muted-foreground">{count === 0 ? "No replies yet" : countLabel}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {shown.replies.map((m, i) => (
              <MessageItem
                key={m.id}
                message={m}
                bubble={bubble}
                grouped={i > 0 && shown.replies[i - 1].author_id === m.author_id}
                names={names}
                meId={meId}
                canAct={canPost}
                actions={threadActions}
                highlight={m.id === flash}
                {...editProps(m)}
              />
            ))}
          </>
        )}
      </div>
      {sendError && <p className="px-4 pb-1 text-xs text-danger" role="alert">{sendError}</p>}
      {canPost && parentId && (
        <Composer
          key={parentId}
          conversationId={conversation.id}
          members={conversation.members}
          meId={meId}
          placeholder="Reply in thread"
          chatPlaceholder="Reply"
          onSend={reply}
          onEditLast={editLast}
          autoFocus
          chat
        />
      )}
      <DeleteMessageDialog
        open={!!confirmDelete}
        canEveryone={!!confirmDelete && mayDelete(confirmDelete)}
        onEveryone={() => void deleteForAll()}
        onForMe={() => void deleteForMe()}
        onCancel={() => setConfirmDelete(null)}
      />
    </aside>
  );
}
