import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import Link from "next/link";
import { IndentApprovalActions } from "./indent-approval-actions";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { withCreators } from "@/lib/created-by";

type IndentRow = {
  id: string;
  code: string | null;
  department: string | null;
  required_date: string | null;
  status: string;
  created_at: string;
  /** Resolved to a name by `withCreators()`; `createdColumns` prints it. */
  created_by: string | null;
  line_count: number;
};

async function getPendingIndents(): Promise<IndentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_indents")
    .select("id, code, department, required_date, status, created_at, created_by")
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

  const rows = (data as Record<string, unknown>[]).map((d) => ({
    id: d.id as string,
    code: d.code as string | null,
    department: d.department as string | null,
    required_date: d.required_date as string | null,
    status: d.status as string,
    created_at: d.created_at as string,
    // Carried across the rebuild — a re-mapped row drops a column as silently
    // as a select that never asked for it (AGENTS.md names this shape).
    created_by: (d.created_by as string | null) ?? null,
    line_count: countMap.get(d.id as string) ?? 0,
  }));
  return withCreators(rows);
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
    {
      header: "",
      align: "right",
      cell: (r) => <IndentApprovalActions indentId={r.id} status={r.status} />,
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
            columns={withCreatedColumns(columns, indents)}
            rows={indents}
            getKey={(r) => r.id}
          />
        </CardBody>
      </Card>
    </div>
  );
}
