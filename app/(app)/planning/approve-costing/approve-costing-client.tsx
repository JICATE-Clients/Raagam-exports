"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { approveCosting, rejectCosting } from "@/lib/planning/costing-approval-actions";
import { QC_STATUS_LABELS, qcStatusTone } from "@/lib/sales/quote-costings/types";
import type { QuoteCosting } from "@/lib/sales/quote-costings/types";

interface Props {
  rows: QuoteCosting[];
  canApprove: boolean;
}

export function ApproveCostingClient({ rows, canApprove }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  const columns: Column<QuoteCosting>[] = [
    { header: "Costing No", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
    { header: "Style", cell: (r) => <span className="text-sm">{r.style?.code ?? r.style?.style_name ?? "—"}</span> },
    { header: "FOB", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.fob_value)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={qcStatusTone(r.status)}>{QC_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) =>
        canApprove && r.status === "finalised" ? (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => approveCosting(r.id), "Costing approved")}>Approve</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => rejectCosting(r.id), "Costing rejected")}>Reject</Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No finalised costings awaiting approval." />;
}
