"use client";

import { useTransition } from "react";
import { acknowledgeIndent, convertIndent } from "@/lib/purchase/extras-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function IndentApprovalActions({
  indentId,
  status,
}: {
  indentId: string;
  status: string;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function handleAcknowledge() {
    startTransition(async () => {
      const result = await acknowledgeIndent(indentId);
      if (result.ok) success("Indent acknowledged.");
      else toastError(result.error);
    });
  }

  function handleConvert() {
    startTransition(async () => {
      const result = await convertIndent(indentId);
      if (result.ok) success("Indent converted to PO.");
      else toastError(result.error);
    });
  }

  return (
    <div className="flex gap-2">
      {status === "open" && (
        <Button size="sm" disabled={isPending} onClick={handleAcknowledge}>
          {isPending ? "..." : "Acknowledge"}
        </Button>
      )}
      {status === "acknowledged" && (
        <Button size="sm" disabled={isPending} onClick={handleConvert}>
          {isPending ? "..." : "Convert to PO"}
        </Button>
      )}
    </div>
  );
}
