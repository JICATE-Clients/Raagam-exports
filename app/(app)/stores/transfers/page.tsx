import { requirePermission, can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { listStoreNavLinks, getItems } from "@/lib/stores/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { fmtDate, fmtNumber } from "@/lib/format";
import { TransferForm } from "./transfer-form";

type TransferRow = {
  id: string;
  store_name: string | null;
  item_name: string | null;
  movement_type: string;
  quantity: number;
  counterparty_store_name: string | null;
  note: string | null;
  created_at: string;
};

async function listTransfers(): Promise<TransferRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_ledger")
    .select("id, store_id, item_id, movement_type, quantity, counterparty_store_id, note, created_at, stores!stock_ledger_store_id_fkey(name), items(name)")
    .in("movement_type", ["transfer_in", "transfer_out"])
    .order("created_at", { ascending: false })
    .limit(100);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    store_name: (r.stores as { name: string } | null)?.name ?? null,
    item_name: (r.items as { name: string } | null)?.name ?? null,
    movement_type: r.movement_type as string,
    quantity: r.quantity as number,
    counterparty_store_name: null,
    note: r.note as string | null,
    created_at: r.created_at as string,
  }));
}

export default async function TransfersPage() {
  await requirePermission("stores", "view");
  const [transfers, stores, items, canCreate] = await Promise.all([
    listTransfers(),
    listStoreNavLinks(),
    getItems(),
    can("stores", "create"),
  ]);

  const columns: Column<TransferRow>[] = [
    {
      header: "Type",
      cell: (r) => (
        <span className={`text-xs font-medium ${r.movement_type === "transfer_in" ? "text-success" : "text-warning"}`}>
          {r.movement_type === "transfer_in" ? "IN" : "OUT"}
        </span>
      ),
    },
    {
      header: "Store",
      cell: (r) => <span className="text-sm">{r.store_name ?? "--"}</span>,
    },
    {
      header: "Item",
      cell: (r) => <span className="text-sm">{r.item_name ?? "--"}</span>,
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span>,
    },
    {
      header: "Note",
      cell: (r) => <span className="max-w-xs truncate text-xs text-muted-foreground">{r.note ?? "--"}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Transfers"
        description="Transfer materials between stores"
        actions={canCreate ? <TransferForm stores={stores} items={items} /> : undefined}
      />
      <Card>
        <CardHeader><CardTitle>Recent Transfers</CardTitle></CardHeader>
        <CardBody>
          <DataTable columns={columns} rows={transfers} getKey={(r) => r.id} empty="No transfers recorded." />
        </CardBody>
      </Card>
    </div>
  );
}
