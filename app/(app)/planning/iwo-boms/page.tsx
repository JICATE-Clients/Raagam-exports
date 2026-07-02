import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { listIwosWithBomFlag, type IwoRow } from "@/lib/planning/extras-service";

export default async function IwoBomsPage() {
  await requirePermission("planning", "view");
  const rows = await listIwosWithBomFlag();

  const columns: Column<IwoRow>[] = [
    {
      header: "Work order",
      cell: (r) => (
        <Link href={`/planning/iwo-boms/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? r.id.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Title", cell: (r) => <span className="text-sm">{r.title}</span> },
    {
      header: "BOM",
      cell: (r) => (
        <StatusPill tone={r.has_bom ? "success" : "neutral"}>{r.has_bom ? "Has BOM" : "No BOM"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="BOM for Internal Work Orders"
        description="Prepare the material BOM for each internal work order (created in Orders)."
      />
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        empty="No internal work orders yet. Create one in Orders ▸ Internal Work Orders first."
      />
    </div>
  );
}
