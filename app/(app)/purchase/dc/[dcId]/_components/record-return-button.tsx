"use client";

import { useState, useTransition } from "react";
import { recordDcReturn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dcLineBalance } from "@/lib/purchase/types";

interface Props {
  lineId: string;
  sentQty: number;
  returnedQty: number;
}

export function RecordReturnButton({ lineId, sentQty, returnedQty }: Props) {
  const balance = dcLineBalance({ sent_qty: sentQty, returned_qty: returnedQty });
  const [isPending, startTransition] = useTransition();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(balance));

  if (balance <= 0) {
    return (
      <span className="text-xs text-muted-foreground">Fully returned</span>
    );
  }

  function handleSubmit() {
    const parsed = parseFloat(qty);
    if (!parsed || parsed <= 0) {
      error("Enter a valid quantity");
      return;
    }
    startTransition(async () => {
      const result = await recordDcReturn(lineId, parsed);
      if (result.ok) {
        success("Return recorded");
        setOpen(false);
      } else {
        error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record Return
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0.01}
        max={balance}
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="w-24 text-right tabular-nums"
        autoFocus
      />
      <Button size="sm" onClick={handleSubmit} disabled={isPending}>
        {isPending ? "…" : "Confirm"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
        disabled={isPending}
      >
        Cancel
      </Button>
    </div>
  );
}
