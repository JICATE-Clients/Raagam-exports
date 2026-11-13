"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useModalGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";

const noop = () => () => {};

/**
 * PULSE'S CONFIRM POPUP (user 2026-11-12, artifact "Pulse Confirm Popup" v4):
 * WhatsApp's shape, compact and with NO explanation text — "Delete chat with
 * Roja?", then stacked: the action as an outlined pill, Cancel beneath it. 200px
 * wide, 8px side padding. It replaces the app's two-button ConfirmDialog
 * everywhere in Pulse; the per-message "Delete message?" (delete-message-dialog.tsx)
 * was already this shape.
 *
 * Built like ConfirmDialog (components/ui/confirm-dialog.tsx) and for the same
 * reasons: portalled (it opens from the chat list, sheets and the chat), so it
 * covers the app; `useModalGuard`; `role="dialog"` so Tab stays inside; Escape
 * closes and stops there; focus lands on CANCEL so a stray Enter does nothing.
 */
export function PulseConfirm({
  open,
  title,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  isPending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** "Delete chat with Roja?" — the whole message; there is no body. */
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // document.body exists only in the browser: false on the server, true once hydrated —
  // without the setState-in-effect that confirm-dialog.tsx carries.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  useModalGuard(open);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted || !open) return null;

  // button-shape: exempt -- the client's WhatsApp confirm (artifact "Pulse Confirm Popup"): full-width pills, which Button's 8px corners cannot draw
  const PILL =
    "flex h-[34px] w-full items-center justify-center rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pulse-confirm-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        className="w-full max-w-[200px] rounded-2xl bg-surface px-2 pb-2 pt-4 text-center shadow-xl focus:outline-none"
      >
        <h2 id="pulse-confirm-title" className="mb-3 break-words px-1 text-[15px] font-semibold leading-snug text-foreground">
          {title}
        </h2>
        <div className="grid gap-0.5">
          {/* button-shape: exempt -- see PILL above */}
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={cn(
              PILL,
              "border border-border bg-surface",
              tone === "danger" ? "text-danger hover:bg-danger/10" : "text-primary hover:bg-surface-muted",
            )}
          >
            {isPending ? "…" : confirmLabel}
          </button>
          {/* button-shape: exempt -- see PILL above */}
          <button ref={cancelRef} type="button" onClick={onCancel} className={cn(PILL, "text-primary hover:bg-surface-muted")}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
