"use client";

/**
 * Budget ▸ Copy From — pick an earlier budget and bring its RATES across.
 *
 * A sub-detail of an already-open editor, so `size="sm"` (AGENTS.md "A
 * sub-detail Sheet's size"): one picker, nothing to scroll. Unlike most sheets
 * of that shape it DOES have an action of its own — "Copy rates" is the whole
 * point of opening it — so its footer is Cancel / Copy rather than a
 * `SubSheetFooter`. What it copies still lands in the budget's own state and is
 * written by the budget's own Save; this sheet saves nothing.
 *
 * Which rates match which lines is `copyRatesFrom`'s rule, not this file's.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { RecordPicker } from "@/components/masters/record-picker";
import { fmtDate } from "@/lib/format";
import { listCopyableBudgets } from "@/lib/orders/budget/actions";

type Option = { id: string; code: string | null; name: string; inactive: boolean };

export function CopyFromSheet({
  open,
  onClose,
  excludeId,
  origin,
  isPending,
  onCopy,
}: {
  open: boolean;
  onClose: () => void;
  /** The budget being edited — copying a budget onto itself is a no-op that
   *  reads as a result. */
  excludeId: string | null;
  origin?: DOMRect | null;
  isPending: boolean;
  onCopy: (budgetId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Every reset happens in the answer, not before the ask: one render per
    // open instead of a blank flash and then the list.
    listCopyableBudgets().then((res) => {
      if (!live) return;
      setPicked(null);
      setLoadError(null);
      if (!res.ok) {
        // A FAILED LOAD IS AN ERROR, NOT AN EMPTY LIST — "nothing to copy
        // from" and "could not ask" must not look alike.
        setLoadError(res.error);
        setOptions([]);
        return;
      }
      setOptions(
        res.budgets
          .filter((b) => b.id !== excludeId)
          .map((b) => ({
            id: b.id,
            code: b.code,
            // NAMED BY ITS ORDERS, not only its code: "which budget priced this
            // customer's last order" is the question being asked. A group is
            // labelled by its first order, with the count saying there are more.
            name: [
              b.code,
              b.first_order?.re_no,
              b.first_order?.customer_name,
              b.order_count > 1 ? `+${b.order_count - 1} more` : null,
              b.description,
              fmtDate(b.budget_date),
            ]
              .filter(Boolean)
              .join(" · "),
            inactive: false,
          })),
      );
    });
    return () => {
      live = false;
    };
  }, [open, excludeId]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Copy rates from"
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!picked || isPending} onClick={() => picked && onCopy(picked)}>
            {isPending ? "Copying…" : "Copy rates"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label="Budget" required size="full">
          <RecordPicker
            label="Budget"
            compact
            required
            items={options}
            value={picked}
            onChange={setPicked}
            emptyHint={loadError ?? "No other budget to copy from yet"}
          />
        </Field>
      </FieldGrid>
    </Sheet>
  );
}
