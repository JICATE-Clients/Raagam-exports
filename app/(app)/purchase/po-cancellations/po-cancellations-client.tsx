"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { cancelPurchaseOrder } from "@/lib/purchase/extras-actions";
import type { PoCancellationWithRefs, PoOption } from "@/lib/purchase/extras-service";

interface Props {
  rows: PoCancellationWithRefs[];
  pos: PoOption[];
  canEdit: boolean;
}

export function PoCancellationsClient({ rows, pos, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [poId, setPoId] = useState("");
  const [reason, setReason] = useState("");

  function handleCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!poId) {
      toastError("Select a PO");
      return;
    }
    startTransition(async () => {
      const r = await cancelPurchaseOrder(poId, reason);
      if (r.ok) {
        success("Purchase order cancelled");
        setPoId(""); setReason("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PoCancellationWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PO", cell: (r) => <span className="text-sm">{r.po_code ?? "—"}</span> },
    { header: "Vendor", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason}</span> },
    { header: "Cancelled", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span> },
  ];

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Cancel a purchase order</CardTitle>
          </CardHeader>
          <CardBody>
            {pos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cancellable purchase orders.</p>
            ) : (
              <form onSubmit={handleCancel} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <Label htmlFor="pc-po">Purchase order</Label>
                  <Select id="pc-po" value={poId} onChange={(e) => setPoId(e.target.value)}>
                    <option value="">— select PO —</option>
                    {pos.map((p) => <option key={p.id} value={p.id}>{p.code ?? p.id.slice(0, 8)}{p.vendor_name ? ` — ${p.vendor_name}` : ""}</option>)}
                  </Select>
                </div>
                <div className="min-w-[240px] flex-1">
                  <Label htmlFor="pc-reason">Reason</Label>
                  <Input id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
                </div>
                <Button type="submit" variant="outline" className="text-danger hover:border-danger" disabled={isPending}>
                  {isPending ? "Cancelling…" : "Cancel PO"}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      )}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No cancellations logged yet." />
    </div>
  );
}
