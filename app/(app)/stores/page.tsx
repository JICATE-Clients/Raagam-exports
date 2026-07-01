import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { listAccessibleStores } from "@/lib/stores/service";
import { STORE_TYPE_LABELS } from "@/lib/stores/types";
import { fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StoreWithStats } from "@/lib/stores/service";
import type { StoreType } from "@/lib/stores/types";
import type { StatusTone } from "@/components/ui/status-pill";

function storeTypeTone(type: StoreType): StatusTone {
  switch (type) {
    case "purchase":
      return "info";
    case "processing":
      return "warning";
    case "material":
      return "success";
    case "rejection":
      return "danger";
    case "surplus":
      return "neutral";
  }
}

const columns: Column<StoreWithStats>[] = [
  {
    header: "Code",
    cell: (s) => (
      <Link
        href={`/stores/${s.id}`}
        className="font-mono text-xs font-semibold text-primary hover:underline"
      >
        {s.code}
      </Link>
    ),
  },
  {
    header: "Name",
    cell: (s) => (
      <Link
        href={`/stores/${s.id}`}
        className="text-sm font-medium hover:text-primary"
      >
        {s.name}
      </Link>
    ),
  },
  {
    header: "Type",
    cell: (s) => (
      <StatusPill tone={storeTypeTone(s.store_type)}>
        {STORE_TYPE_LABELS[s.store_type]}
      </StatusPill>
    ),
  },
  {
    header: "Items",
    align: "right",
    cell: (s) => (
      <span className="tabular-nums text-sm">{fmtNumber(s.item_count)}</span>
    ),
  },
  {
    header: "Total qty",
    align: "right",
    cell: (s) => (
      <span className="tabular-nums text-sm">{fmtNumber(s.total_qty)}</span>
    ),
  },
  {
    header: "Status",
    cell: (s) => (
      <StatusPill tone={s.is_active ? "success" : "neutral"}>
        {s.is_active ? "Active" : "Inactive"}
      </StatusPill>
    ),
  },
];

export default async function StoresPage() {
  await requirePermission("stores", "view");
  const stores = await listAccessibleStores();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stores"
        description="Stock locations and live balances"
      />
      <DataTable
        columns={columns}
        rows={stores}
        getKey={(s) => s.id}
        empty="No stores accessible. Contact your administrator."
      />
    </div>
  );
}
