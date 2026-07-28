import { requirePermission, can } from "@/lib/auth/server";
import { listProcessReceipts, listProcessOrders } from "@/lib/stores/process-service";
import { listStoreNavLinks, getItems } from "@/lib/stores/service";
import { ProcessReceiptForm } from "./process-receipt-form";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import type { ProcessMaterialReceipt } from "@/lib/stores/process-types";

export default async function ProcessReceiptsPage() {
  await requirePermission("stores", "view");
  const [receipts, procOrders, stores, items, canCreate] = await Promise.all([
    listProcessReceipts(),
    listProcessOrders(),
    listStoreNavLinks(),
    getItems(),
    can("stores", "create"),
  ]);

  const columns: Column<ProcessMaterialReceipt>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-medium">{r.code ?? "--"}</span>,
    },
    {
      header: "Receipt Date",
      cell: (r) => <span className="text-sm">{r.receipt_date ? fmtDate(r.receipt_date) : "--"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.status === "posted" ? "success" : "neutral"}>
          {r.status === "posted" ? "Posted" : "Draft"}
        </StatusPill>
      ),
    },
    {
      header: "Created",
      cell: (r) => <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process Material Receipts"
        description="Receive processed materials back from vendors"
        actions={canCreate ? <ProcessReceiptForm processOrders={procOrders.map((o) => ({ id: o.id, code: o.code }))} stores={stores} items={items} /> : undefined}
      />
      <DataTable columns={columns} rows={receipts} getKey={(r) => r.id} empty="No process receipts yet." />
    </div>
  );
}
