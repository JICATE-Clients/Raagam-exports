"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * THE BAR THAT APPEARS WHILE ROWS ARE TICKED — "N selected", Clear, and the
 * screen's own bulk buttons (user 2026-09-30, Admin ▸ Users and Access
 * Control: "select check box in front … for bulk setting the data").
 *
 * `BulkActionsBar` (components/data-io) is the same bar for a data-io master
 * and knows only Activate / Deactivate / Export. A screen whose bulk work is
 * something else — send a welcome mail, assign a role — passes its buttons as
 * children here instead, so both draw one bar.
 *
 * toolbar-size: exempt -- this is not the header row. It appears below it, only
 * while rows are selected, and every button in it is `sm` together.
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
    >
      <span className="mr-auto text-sm font-semibold">{count} selected</span>
      {children}
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        <X className="h-4 w-4" aria-hidden />
        Clear
      </Button>
    </div>
  );
}

/**
 * A bulk button that can undo nothing (delete, reset passwords) asks twice:
 * the first click arms it and the label changes to say what the second will
 * do. Leaving the button (blur) disarms it.
 */
export function ConfirmBulkButton({
  label,
  confirmLabel,
  icon,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  icon?: ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      type="button"
      variant={armed ? "danger" : "outline"}
      size="sm"
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {icon}
      {armed ? confirmLabel : label}
    </Button>
  );
}
