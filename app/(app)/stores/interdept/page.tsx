import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";

type InterdeptRow = {
  id: string;
  code: string | null;
  from_department: string;
  to_department: string;
  delivery_date: string | null;
  status: string;
  created_at: string;
};

function interdeptStatusTone(status: string): StatusTone {
  switch (status) {
    case "draft": return "neutral";
    case "delivered": return "warning";
    case "received": return "success";
    default: return "neutral";
  }
}

async function listInterdeptDeliveries(): Promise<InterdeptRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("interdept_deliveries")
    .select("id, code, from_department, to_department, delivery_date, status, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as InterdeptRow[];
}

export default async function InterdeptPage() {
  await requirePermission("stores", "view");
  const deliveries = await listInterdeptDeliveries();

  const columns: Column<InterdeptRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-medium">{r.code ?? "--"}</span>,
    },
    {
      header: "From",
      cell: (r) => <span className="text-sm">{r.from_department}</span>,
    },
    {
      header: "To",
      cell: (r) => <span className="text-sm">{r.to_department}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-sm">{r.delivery_date ? fmtDate(r.delivery_date) : "--"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={interdeptStatusTone(r.status)}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
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
        title="Inter-department Deliveries"
        description="Material transfers between departments"
      />
      <Card>
        <CardHeader><CardTitle>Deliveries</CardTitle></CardHeader>
        <CardBody>
          <DataTable columns={columns} rows={deliveries} getKey={(r) => r.id} empty="No inter-department deliveries yet." />
        </CardBody>
      </Card>
    </div>
  );
}
