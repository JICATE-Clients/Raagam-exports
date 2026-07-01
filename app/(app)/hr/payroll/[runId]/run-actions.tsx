"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  calculatePayroll,
  approvePayroll,
  lockPayroll,
  markPaid,
} from "@/lib/hr/payroll-actions";
import type { PayrollStatus } from "@/lib/hr/types";

export function RunActions({
  runId,
  status,
  canEdit,
  canApprove,
}: {
  runId: string;
  status: PayrollStatus;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        success("Done");
      } else {
        error(result.error ?? "Something went wrong");
      }
    });
  }

  const canRecalculate = canEdit && (status === "draft" || status === "calculated");
  const canApproveRun = canApprove && status === "calculated";
  const canLock = canApprove && status === "approved";
  const canMarkPaid = canApprove && status === "locked";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRecalculate && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => calculatePayroll(runId))}
        >
          {status === "draft" ? "Calculate" : "Recalculate"}
        </Button>
      )}
      {canApproveRun && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => approvePayroll(runId))}
        >
          Approve
        </Button>
      )}
      {canLock && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => lockPayroll(runId))}
        >
          Lock
        </Button>
      )}
      {canMarkPaid && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => markPaid(runId))}
        >
          Mark paid
        </Button>
      )}
    </div>
  );
}
