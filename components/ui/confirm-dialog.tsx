"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useModalGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";

/**
 * A small centred confirm modal — "Delete CHENNAI?", [Cancel] [Delete].
 *
 * ## WHY THIS EXISTS WHEN `RowActions` ALREADY CONFIRMS
 *
 * `RowActions` confirms IN PLACE: clicking the bin swaps the three icons for
 * `Delete? [Cancel] [Confirm]`, which is why `ROW_ACTIONS_WIDTH` is sized for
 * the confirm strip rather than the icons. That trick needs the cell to still
 * be on screen — and once Delete moves INSIDE the `⋮` menu the cell is a single
 * button and the menu has already closed by the time the handler runs. There is
 * nothing left to swap. A dialog is what replaces it, and the client asked for
 * one by name.
 *
 * ## IT MUST NOT PROMISE WHICH THING IS ABOUT TO HAPPEN
 *
 * `lib/masters/delete-guard.ts` decides delete-vs-deactivate SERVER-SIDE, from
 * whether anything references the row — so a dialog reading "This cannot be
 * undone" is a lie on every master row something points at, which is most of
 * them. `deletedToast` is what says which one happened, afterwards. The default
 * body below says what is true before the click and nothing more; a caller with
 * a genuinely irreversible action passes its own wording.
 *
 * ## GUARDS AND KEYS COME FROM THE CONTRACTS THAT ALREADY EXIST
 *
 * - `useModalGuard(open)` — AGENTS.md "Auto-reload guard": a hand-rolled
 *   `fixed inset-0` overlay is invisible to the guard's DOM scan unless it says
 *   so. This one ALSO carries `role="dialog"` + `aria-modal`, so `hasOpenModalInDom`
 *   sees it too; both, because the scan only covers overlays that are mounted
 *   while open (this one is) and the hook covers it regardless.
 * - **Tab traps between the two buttons for free.** `cycleTab` in `lib/focus.ts`
 *   falls back to "every focusable" on a surface with nothing field-like, and
 *   its own comment names "a confirm dialog: message, Cancel, OK" as the case
 *   that fallback is for. `role="dialog"` is what puts this in `isEditorScope`.
 * - **Escape closes, and stops there.** `stopPropagation` keeps the app's
 *   one-layer-per-press Escape from also closing the editor behind this.
 *
 * ## FOCUS LANDS ON CANCEL, NOT CONFIRM
 *
 * A destructive dialog that opens with Confirm focused turns a stray Enter —
 * the key this app trains operators to hold down — into the delete they were
 * about to think about.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  isPending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** "Delete CHENNAI?" — the record's name belongs here, not in the body. */
  title: string;
  /** Defaults to the delete-guard-safe wording; pass your own to override. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Disables Confirm while the action is in flight. */
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Portal targets document.body, which does not exist during SSR. Render
  // nothing until mounted so the server and first client render agree. Copied
  // verbatim from `sheet.tsx` and `import-dialog.tsx`, the app's two other
  // portal dialogs, rather than invented here - all three trip
  // `react-hooks/set-state-in-effect`, and a fourth spelling of one pattern
  // would be worse than the warning.
  useEffect(() => setMounted(true), []);
  useModalGuard(open);

  useEffect(() => {
    if (!open) return;
    // Deliberately the CANCEL button — see the note above.
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // Backdrop only — a mousedown that began inside the panel must not
        // close it (a drag off the edge of a text selection otherwise does).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl focus:outline-none"
      >
        <h2 id="confirm-dialog-title" className="text-sm font-bold text-foreground">
          {title}
        </h2>
        <div className="mt-1.5 text-sm text-muted-foreground">
          {body ?? "This record will be removed from the list and from every picker that offers it."}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button ref={cancelRef} variant="outline" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            size="md"
            disabled={isPending}
            onClick={onConfirm}
            className={cn(isPending && "opacity-70")}
          >
            {isPending ? "…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
