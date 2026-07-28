import { requirePermission, can } from "@/lib/auth/server";
import { listProcessIssues, listProcessOrders } from "@/lib/stores/process-service";
import { listStoreNavLinks, getItems } from "@/lib/stores/service";
import { ProcessIssueForm } from "./process-issue-form";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import type { ProcessMaterialIssue } from "@/lib/stores/process-types";

export default async function ProcessIssuesPage() {
  await requirePermission("stores", "view");
  const [issues, procOrders, stores, items, canCreate] = await Promise.all([
    listProcessIssues(),
    listProcessOrders(),
    listStoreNavLinks(),
    getItems(),
    can("stores", "create"),
  ]);

  const columns: Column<ProcessMaterialIssue>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-medium">{r.code ?? "--"}</span>,
    },
    {
      header: "Issue Date",
      cell: (r) => <span className="text-sm">{r.issue_date ? fmtDate(r.issue_date) : "--"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.status === "issued" ? "success" : "neutral"}>
          {r.status === "issued" ? "Issued" : "Draft"}
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
        title="Process Material Issues"
        description="Issue materials from store to external processors"
        actions={canCreate ? <ProcessIssueForm processOrders={procOrders.map((o) => ({ id: o.id, code: o.code }))} stores={stores} items={items} /> : undefined}
      />
      <DataTable columns={columns} rows={issues} getKey={(r) => r.id} empty="No process issues yet." />
    </div>
  );
}
