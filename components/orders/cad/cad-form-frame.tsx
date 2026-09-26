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
 * THE INLINE PANEL IS ITS OWN KEYBOARD SURFACE. It sits inside the order
 * editor, whose Save writes the ORDER. `data-focus-scope` makes the panel the
 * boundary Tab wraps inside, and `data-focus-region="footer"` makes its own
 * last button what Enter off the last field presses (`submitTargetOf` rule 1).
 * Without the two markers, Enter off the CAD's last field would have saved the
 * garment order instead.
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
      data-focus-scope
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
