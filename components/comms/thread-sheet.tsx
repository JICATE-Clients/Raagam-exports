"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { loadThread, sendMessage } from "@/lib/comms/actions";
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
                canAct={false}
                canDelete={false}
                actions={{ onOpenFile }}
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
                  canAct={false}
                  canDelete={false}
                  actions={{ onOpenFile }}
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
