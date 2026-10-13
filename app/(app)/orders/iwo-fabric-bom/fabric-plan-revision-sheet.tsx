"use client";

/**
 * RAISE REVISION on an approved sample Fabric Plan (0718, client brief
 * 2026-10-13 §2: "any changes to weights or processes must go through a
 * Fabric Plan Revision").
 *
 * One field, the reason, and it is mandatory — the revision log keeps it
 * beside the yarn weights that had been approved, and the approver reads it
 * when the revised plan comes back. Raising reopens the plan for editing and
 * pauses purchasing until the revision is approved.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { raiseFabricPlanRevision } from "@/lib/orders/iwo-fabric-bom/approval-actions";

export function FabricPlanRevisionSheet({
  bomId,
  planLabel,
  nextRevision,
  origin,
  onClose,
  onRaised,
}: {
  bomId: string;
  /** The SWO number — what the operator calls the plan. */
  planLabel: string;
  nextRevision: number;
  origin?: SheetOrigin | null;
  onClose: () => void;
  onRaised: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [reason, setReason] = useState("");

  function raise() {
    start(async () => {
      const res = await raiseFabricPlanRevision(bomId, reason);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`Revision ${res.revisionNo ?? nextRevision} opened — edit the plan, save, then submit it for approval`);
      onRaised();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Raise Revision ${nextRevision} · ${planLabel}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending || !reason.trim()} onClick={raise}>
            {isPending ? "Raising…" : "Raise Revision"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label="Why is the plan being revised?" required size="full" htmlFor="fp-rev-reason">
          <Textarea id="fp-rev-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </FieldGrid>
      <p className="mt-3 text-xs text-muted-foreground">
        The plan opens for editing and yarn purchasing pauses until the revised plan is approved. The weights approved
        so far are kept on record.
      </p>
    </Sheet>
  );
}
