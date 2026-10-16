"use client";

/**
 * THE BUYER'S ANSWER TO A QUOTE — Customer Approved / Customer Rejected on an
 * Under Progress sample costing (0725, doc/sample/developer-ui-field-updates-
 * report-v8.md §8.1: "Status changes to Approved ONLY when customer confirms
 * acceptance via email"). The merchandiser records what the buyer's email said.
 *
 * One field. For a rejection it is mandatory — the Rejected tab of the tracking
 * report shows it as the reason. For an acceptance it is optional (an email
 * reference, the agreed price), and the approval locks the sample entry.
 *
 * The twin of `PlanRevisionSheet`, deliberately: same size, same placement.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { recordCustomerDecision } from "@/lib/sales/sample-costing/actions";

export type CustomerDecision = "approved" | "rejected";

export function CustomerDecisionSheet({
  decision,
  costingId,
  costingLabel,
  origin,
  onClose,
  onDone,
}: {
  decision: CustomerDecision;
  costingId: string;
  /** "CST/26-27/0004 · Rev 1" — what the operator calls the quote. */
  costingLabel: string;
  origin?: SheetOrigin | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [remark, setRemark] = useState("");
  const approving = decision === "approved";

  function save() {
    start(async () => {
      const res = await recordCustomerDecision(costingId, decision, remark);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(approving ? `${costingLabel} approved by the buyer — the sample is now locked.` : `${costingLabel} marked rejected by the buyer.`);
      onDone();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${approving ? "Customer Approved" : "Customer Rejected"} · ${costingLabel}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" variant={approving ? "primary" : "danger"} disabled={isPending || (!approving && !remark.trim())} onClick={save}>
            {isPending ? "Saving…" : approving ? "Mark Approved" : "Mark Rejected"}
          </Button>
        </>
      }
    >
      {/* One remark, at the `name` step (288px) — the free-text width every
          master's Notes takes; the sheet is `sm`, so it never clips. */}
      <FieldRow>
        <Field
          label={approving ? "Buyer's confirmation (email ref, agreed price)" : "Why did the buyer decline?"}
          required={!approving}
          w="name"
          htmlFor="cd-remark"
        >
          <Textarea id="cd-remark" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Field>
      </FieldRow>
      <p className="mt-3 text-xs text-muted-foreground">
        {approving
          ? "Record this only once the buyer has confirmed by email. The quoted rates are locked, and so is the sample entry; Revise opens the next revision if the price has to change later."
          : "The quote moves to Rejected. Raise Revise opens the next revision as a Draft; saving it sends it back to the buyer."}
      </p>
    </Sheet>
  );
}
