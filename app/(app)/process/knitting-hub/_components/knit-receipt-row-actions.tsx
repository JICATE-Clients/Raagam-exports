"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { RowActions } from "@/components/ui/row-actions";
import { deleteKnittingReceipt } from "@/lib/production/knitting-actions";

/**
 * The bin on a Fabric Receipt / Yarn Return row (0839). The register is server-rendered, so the
 * one client island is this cell. A posted document has no edit; delete reverses the posting.
 * Greyed with the reason while its Knitting Order is closed (AGENTS.md "Row actions": hiding is
 * for missing permission only); every other refusal is the server's own sentence.
 */
export function KnitReceiptRowActions({
  id,
  code,
  orderStatus,
  canDelete,
}: {
  id: string;
  code: string | null;
  orderStatus: string | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  const open = orderStatus === "in_process" || orderStatus === "partially_received";
  return (
    <RowActions
      label={code}
      view={false}
      canEdit={false}
      canDelete={canDelete}
      deleteDisabledReason={open ? null : "Its Knitting Order is closed — the receipt is final"}
      onDelete={() =>
        startTransition(async () => {
          const res = await deleteKnittingReceipt(id);
          if (res.ok) {
            success(`${code ?? "Receipt"} deleted — its stock was reversed`);
            router.refresh();
          } else toastError(res.error);
        })
      }
    />
  );
}
