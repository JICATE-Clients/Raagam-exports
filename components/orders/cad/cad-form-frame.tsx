"use client";

/**
 * The frame around a CAD step's form — a `Sheet` on Orders ▸ CAD ▸ CAD
 * Lifecycle, or an INLINE PANEL in Order Entry ▸ CAD (user 2026-09-25,
 * screenshot 3059: the tab showed a table and a lot of empty space, with the
 * form one click away in a pop-up; "this area should list the form").
 *
 * ONE FORM, TWO FRAMES. The Allocation / Dispatch / Decision sheets keep their
 * fields, rules and actions; only the wrapper changes. So the two doors still
 * cannot offer a style different steps (the `useCadActions` rule).
 *
 * THE INLINE PANEL HAS NO BUTTONS (user 2026-09-30, screenshot 3136: "no need
 * [a separate save] … while saving order the CAD details also will save"). The
 * forms park their step in `cad-pending.ts` and the ORDER's Save writes it, so
 * the panel is part of the order's keyboard surface, not its own: no
 * `data-focus-scope`, no footer region, and Enter off the CAD's last field
 * reaches the order's Save like any other section's last field. (It used to
 * carry both markers precisely so that it would NOT — the panel had a Save of
 * its own then.) On a LOCKED order the order's Save is refused while CAD must
 * still work (it is outside the lock), so there the forms pass their buttons
 * again and the panel is its own surface once more — both markers return.
 *
 * `useUnsavedGuard` here does what a `Sheet` does for itself: a typed-but-unsaved
 * CAD step holds off the silent auto-reload (AGENTS.md "Auto-reload guard").
 * Dirty = any input inside the panel, caught once at the container.
 */

import { useState, type ComponentProps, type ReactNode } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";

export function CadFormFrame({
  inline = false,
  open,
  onClose,
  title,
  size,
  alignToPane,
  origin,
  footer,
  children,
}: {
  inline?: boolean;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ComponentProps<typeof Sheet>["size"];
  alignToPane?: boolean;
  origin?: SheetOrigin | null;
  footer?: ReactNode;
  children: ReactNode;
}) {
  if (!inline) {
    return (
      <Sheet open={open} onClose={onClose} title={title} size={size} alignToPane={alignToPane} origin={origin} footer={footer}>
        <div className="space-y-3">{children}</div>
      </Sheet>
    );
  }
  return <InlinePanel title={title} footer={footer}>{children}</InlinePanel>;
}

function InlinePanel({ title, footer, children }: { title: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  return (
    // NO CARD, NO WIDTH CAP (user 2026-09-25, screenshots 3062 + "remaining page
    // layout look instead of the form look"). The step's DetailSections sit on
    // the page exactly as Order Info's do — full pane width, rows ragged-right —
    // and the Component Cut Method grid gets the width to be a table.
    <section
      // Its own keyboard surface only while it has its own buttons (a locked
      // order's CAD) — see the note at the top.
      data-focus-scope={footer ? "" : undefined}
      aria-label={typeof title === "string" ? title : undefined}
      onInputCapture={() => setDirty(true)}
      onChangeCapture={() => setDirty(true)}
      className="space-y-3"
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
      {footer && (
        <div data-focus-region="footer" className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {footer}
        </div>
      )}
    </section>
  );
}
