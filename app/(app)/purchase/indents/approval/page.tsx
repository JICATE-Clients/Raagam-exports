import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import Link from "next/link";

type IndentRow = {
  id: string;
  code: string | null;
  department: string | null;
  required_date: string | null;
  status: string;
  created_at: string;
  line_count: number;
};

async function getPendingIndents(): Promise<IndentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_indents")
    .select("id, code, department, required_date, status, created_at")
    .in("status", ["open", "acknowledged"])
    .order("created_at", { ascending: false });

  if (!data) return [];

  // get line counts
  const ids = data.map((d) => (d as { id: string }).id);
  if (ids.length === 0) return [];

  const { data: lines } = await supabase
    .from("purchase_indent_lines")
    .select("purchase_indent_id")
    .in("purchase_indent_id", ids);

  const countMap = new Map<string, number>();
  for (const l of (lines ?? []) as { purchase_indent_id: string }[]) {
    countMap.set(l.purchase_indent_id, (countMap.get(l.purchase_indent_id) ?? 0) + 1);
  }

  return (data as Record<string, unknown>[]).map((d) => ({
    id: d.id as string,
    code: d.code as string | null,
    department: d.department as string | null,
    required_date: d.required_date as string | null,
    status: d.status as string,
    created_at: d.created_at as string,
    line_count: countMap.get(d.id as string) ?? 0,
  }));
}

export default async function IndentApprovalPage() {
  await requirePermission("materials_purchase", "approve");
  const indents = await getPendingIndents();

  const columns: Column<IndentRow>[] = [
    {
      header: "Indent No",
      cell: (r) => (
        <Link
          href={`/purchase/indents/${r.id}`}
          className="font-medium text-primary hover:underline"
        >
          {r.code ?? "--"}
        </Link>
      ),
    },
    {
      header: "Department",
      cell: (r) => <span className="text-sm">{r.department ?? "--"}</span>,
    },
    {
      header: "Required Date",
      cell: (r) => (
        <span className="text-sm">{r.required_date ? fmtDate(r.required_date) : "--"}</span>
      ),
    },
    {
      header: "Items",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.line_count)}</span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.status === "open" ? "info" : "warning"}>
          {r.status === "open" ? "Open" : "Acknowledged"}
        </StatusPill>
      ),
    },
    {
      header: "Created",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {fmtDate(r.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Indent Approval"
        description="Review and approve pending purchase indents"
      />

      <Card>
        <CardHeader>
          <CardTitle>Pending Indents ({indents.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={columns}
            rows={indents}
            getKey={(r) => r.id}
            empty="No pending indents to approve."
          />
        </CardBody>
      </Card>
    </div>
  );
}
