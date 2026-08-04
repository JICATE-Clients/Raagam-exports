import { requirePermission, can } from "@/lib/auth/server";
import { CompletionForm } from "./completion-form";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { fmtDate } from "@/lib/format";
import { withCreatedColumns } from "@/components/ui/created-columns";

type CompletionRow = {
  id: string;
  code: string | null;
  completion_type: string;
  upto_date: string | null;
  notes: string | null;
  created_at: string;
};

async function listCompletions(): Promise<CompletionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_completions")
    .select("id, code, completion_type, upto_date, notes, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as CompletionRow[];
}

export default async function PoCompletionsPage() {
  await requirePermission("materials_purchase", "view");
  const [completions, canCreate] = await Promise.all([
    listCompletions(),
    can("materials_purchase", "create"),
  ]);

  const columns: Column<CompletionRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-medium">{r.code ?? "--"}</span>,
    },
    {
      header: "Type",
      cell: (r) => <span className="text-sm">{r.completion_type}</span>,
    },
    {
      header: "Upto Date",
      cell: (r) => (
        <span className="text-sm">{r.upto_date ? fmtDate(r.upto_date) : "--"}</span>
      ),
    },
    {
      header: "Notes",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.notes ?? "--"}
        </span>
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
        title="PO Completions"
        description="Mark purchase orders as completed -- no more receipts expected"
        actions={canCreate ? <CompletionForm /> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>Completion Records</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={withCreatedColumns(columns, completions)}
            rows={completions}
            getKey={(r) => r.id}
            empty="No completion records yet."
          />
        </CardBody>
      </Card>
    </div>
  );
}
