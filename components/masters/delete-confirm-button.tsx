"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Two-step destructive row-action for masters list tables: a plain "Delete"
 * ghost button that swaps into an inline "Delete? Cancel/Confirm" once
 * clicked — no accidental single-click deletes. `onConfirm` should already
 * handle the actual delete call (toast + list refresh); this component only
 * owns the two-step UI state. Deliberately does not auto-collapse back to the
 * plain button after Confirm — on success the row disappears from the list
 * on refresh anyway; on failure (e.g. a validation error) it stays open so
 * the user can retry without re-triggering the confirm step.
 */
export function DeleteConfirmButton({
  onConfirm,
  isPending = false,
  label = "Delete",
}: {
  onConfirm: () => void;
  isPending?: boolean;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">{label}?</span>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" disabled={isPending} onClick={onConfirm}>
          {isPending ? "…" : "Confirm"}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => setConfirming(true)}>
      {label}
    </Button>
  );
}
