"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeIndent } from "@/lib/purchase/extras-actions";
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
  const router = useRouter();

  function handleAcknowledge() {
    startTransition(async () => {
      const result = await acknowledgeIndent(indentId);
      if (result.ok) success("Indent acknowledged.");
      else toastError(result.error);
    });
  }

  // A PO needs its vendor (purchase_orders_one_vendor), which is picked on the
  // indent's own page — so Convert goes there rather than converting blind.
  function handleConvert() {
    router.push(`/purchase/indents/${indentId}`);
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
