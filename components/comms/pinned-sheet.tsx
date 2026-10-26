"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { loadPinned } from "@/lib/comms/actions";
import type { CommAttachment, CommMessage } from "@/lib/comms/types";
import { MessageItem } from "./message-item";

/** The conversation's pinned messages, newest pin first. Read on each open. */
export function PinnedSheet({
  open,
  conversationId,
  names,
  meId,
  onClose,
  onOpenFile,
}: {
  open: boolean;
  conversationId: string;
  names: Map<string, string | null>;
  meId: string;
  onClose: () => void;
  onOpenFile: (a: CommAttachment) => void;
}) {
  const [items, setItems] = useState<CommMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadPinned(conversationId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setItems(r.messages);
        setError(null);
      } else {
        setError(r.error);
      }
    });
    return () => {
      live = false;
    };
  }, [open, conversationId, retry]);

  return (
    <Sheet open={open} onClose={onClose} title="Pinned messages" size="sm" alignToPane>
      {error ? (
        <p className="flex items-center gap-2 text-sm text-danger" role="alert">
          {error}
          <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is pinned yet. Pin a message from its hover menu.</p>
      ) : (
        <div className="space-y-1">
          {items.map((m) => (
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
        </div>
      )}
    </Sheet>
  );
}
