"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { loadThread, sendMessage, setReaction, setSaved } from "@/lib/comms/actions";
import { applyReaction } from "@/lib/comms/reactions";
import type { AttachmentInput, CommAttachment, CommMessage, ConversationDetail } from "@/lib/comms/types";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";

/**
 * A thread: the first message and its replies, one level deep (0737).
 *
 * Re-read whenever the conversation's doorbell rings (`version`), so a reply
 * someone else posts arrives here too. Replies are sent and then re-read —
 * not optimistic like the main stream — and a failed send keeps the typed text
 * in the box with the reason, so nothing is lost and Send is the retry.
 */
export function ThreadSheet({
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
}) {
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
  // list. Only reacting is offered here; edit / delete / pin stay where they were.
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
  const threadActions = canPost
    ? { onOpenFile, onSave: (m: CommMessage) => void save(m), onReact: (m: CommMessage, e: string, on: boolean) => void react(m, e, on) }
    : { onOpenFile, onSave: (m: CommMessage) => void save(m) };

  return (
    <Sheet open={!!parent} onClose={onClose} title="Thread" size="sm" alignToPane>
      <div className="flex min-h-[24rem] flex-col">
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
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
                grouped={false}
                names={names}
                meId={meId}
                canAct={canPost}
                canDelete={false}
                actions={threadActions}
              />
              <p className="px-3 py-1 text-xs font-semibold text-muted-foreground">
                {shown.replies.length === 0
                  ? "No replies yet"
                  : `${shown.replies.length} ${shown.replies.length === 1 ? "reply" : "replies"}`}
              </p>
              {shown.replies.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  grouped={false}
                  names={names}
                  meId={meId}
                  canAct={canPost}
                  canDelete={false}
                  actions={threadActions}
                  highlight={m.id === flash}
                />
              ))}
            </>
          )}
        </div>
        {sendError && <p className="px-3 pb-1 text-xs text-danger" role="alert">{sendError}</p>}
        {canPost && parentId && (
          <Composer
            key={parentId}
            conversationId={conversation.id}
            members={conversation.members}
            meId={meId}
            placeholder="Reply in thread"
            onSend={reply}
            autoFocus
          />
        )}
      </div>
    </Sheet>
  );
}
