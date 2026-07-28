"use client";

import { useTransition } from "react";
import {
  submitPriceConfirmation,
  approvePriceConfirmation,
  rejectPriceConfirmation,
} from "@/lib/purchase/price-confirmation-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function PcActions({
  pcId,
  status,
  canEdit,
  canApprove,
}: {
  pcId: string;
  status: string;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function handle(action: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) success(msg);
      else toastError((result as { error: string }).error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && canEdit && (
        <Button disabled={isPending} onClick={() => handle(() => submitPriceConfirmation(pcId), "Submitted for approval.")}>
          {isPending ? "Submitting..." : "Submit for Approval"}
        </Button>
      )}
      {status === "submitted" && canApprove && (
        <>
          <Button disabled={isPending} onClick={() => handle(() => approvePriceConfirmation(pcId), "Approved.")}>
            Approve
          </Button>
          <Button variant="danger" disabled={isPending} onClick={() => handle(() => rejectPriceConfirmation(pcId), "Rejected.")}>
            Reject
          </Button>
        </>
      )}
      {status === "submitted" && !canApprove && (
        <p className="text-sm text-muted-foreground">Awaiting approval.</p>
      )}
      {status === "approved" && (
        <p className="text-sm text-muted-foreground">Rates confirmed and approved.</p>
      )}
      {status === "rejected" && (
        <p className="text-sm text-muted-foreground">This confirmation was rejected.</p>
      )}
    </div>
  );
}
