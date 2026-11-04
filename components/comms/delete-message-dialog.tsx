"use client";

import { useEffect, useRef } from "react";
import { useModalGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";

/**
 * PULSE'S DELETE DIALOG (user 2026-11-04, screenshot 105236 / the Pulse delete
 * mockup): "Delete message?" and, stacked, Delete for everyone · Delete for me ·
 * Cancel — WhatsApp's dialog, not the app's two-button ConfirmDialog.
 *
 * - **Delete for everyone** only when the caller may (`canEveryone`: their own
 *   message, a chat admin, a channel moderator — conversation-view's
 *   `mayDelete`). Everyone else gets Delete for me and Cancel.
 * - **Delete for me** is offered on every message (0807, `hideMessage`).
 *
 * INSIDE THE CHAT, NOT OVER THE APP (user 2026-11-04: "chatting page-a vittu
 * veliya pogakudathu"): no portal. It is `absolute inset-0` in the chat page
 * (conversation-view.tsx, `data-chat-page`, which is `relative`), so the dim
 * covers the open conversation only and the chat list beside it stays clear.
 *
 * Otherwise built like ConfirmDialog (components/ui/confirm-dialog.tsx), and for
 * the same reasons: `useModalGuard`, `role="dialog"` so Tab stays inside, Escape
 * closes and stops there, and focus lands on CANCEL so a stray Enter deletes
 * nothing.
 */
export function DeleteMessageDialog({
  open,
  canEveryone,
  isPending = false,
  onEveryone,
  onForMe,
  onCancel,
}: {
  open: boolean;
  /** The caller may delete this message for every member. */
  canEveryone: boolean;
  isPending?: boolean;
  onEveryone: () => void;
  onForMe: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalGuard(open);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  // button-shape: exempt -- the client's WhatsApp delete dialog (screenshot 105236): full-width outlined pills, which Button's 8px corners cannot draw
  const PILL =
    "flex h-[30px] w-full items-center justify-center rounded-full border border-border bg-surface text-[12.5px] font-medium transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-message-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        className="w-full max-w-[13rem] rounded-[14px] bg-surface px-2.5 pb-1 pt-3 text-center shadow-xl focus:outline-none"
      >
        <h2 id="delete-message-title" className="mb-2.5 text-sm font-medium text-foreground">
          Delete message?
        </h2>
        <div className="grid gap-1">
          {canEveryone && (
            // button-shape: exempt -- see PILL above
            <button type="button" disabled={isPending} onClick={onEveryone} className={cn(PILL, "text-danger")}>
              Delete for everyone
            </button>
          )}
          {/* button-shape: exempt -- see PILL above */}
          <button type="button" disabled={isPending} onClick={onForMe} className={cn(PILL, "text-primary")}>
            Delete for me
          </button>
          {/* button-shape: exempt -- see PILL above */}
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex h-[30px] w-full items-center justify-center rounded-full text-[12.5px] font-medium text-primary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
