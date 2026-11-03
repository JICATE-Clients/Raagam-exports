"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { reopenRequirementBalance } from "@/lib/purchase/re-po/actions";

/**
 * REOPEN A CLOSED BALANCE from the purchase-status report (0799). The report is where a
 * fully-closed RE can still be reached: once every line is closed it leaves Raise PO's
 * Pending list, and with it the Close balances sheet. Screen only (`print:hidden`): the
 * printed report shows the closed qty and reason, never a button.
 */
export function ReopenBalanceButton({ sourceId, reqKey }: { sourceId: string; reqKey: string }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-1 print:hidden"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await reopenRequirementBalance(sourceId, reqKey);
          if (res.ok) {
            success("Balance reopened — it is to order again on Raise PO");
            router.refresh();
          } else toastError(res.error);
        })
      }
    >
      Reopen
    </Button>
  );
}
