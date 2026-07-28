"use client";

import { useTransition } from "react";
import { issueProcessOrder, cancelProcessOrder } from "@/lib/stores/process-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function ProcessOrderActions({
  orderId,
  status,
  canEdit,
}: {
  orderId: string;
  status: string;
  canEdit: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  if (!canEdit) return null;

  function handleIssue() {
    startTransition(async () => {
      const result = await issueProcessOrder(orderId);
      if (result.ok) success("Process order issued.");
      else toastError(result.error);
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelProcessOrder(orderId);
      if (result.ok) success("Process order cancelled.");
      else toastError(result.error);
    });
  }

  return (
    <div className="flex gap-2">
      {status === "draft" && (
        <>
          <Button disabled={isPending} onClick={handleIssue}>
            {isPending ? "Issuing..." : "Issue to Processor"}
          </Button>
          <Button variant="danger" disabled={isPending} onClick={handleCancel}>
            Cancel Order
          </Button>
        </>
      )}
      {status === "issued" && (
        <p className="text-sm text-muted-foreground">Order issued to processor. Awaiting material issue.</p>
      )}
      {status === "in_process" && (
        <p className="text-sm text-muted-foreground">Materials in process. Awaiting receipt.</p>
      )}
      {["received", "closed", "cancelled"].includes(status) && (
        <p className="text-sm text-muted-foreground">
          This order is {status}.
        </p>
      )}
    </div>
  );
}
