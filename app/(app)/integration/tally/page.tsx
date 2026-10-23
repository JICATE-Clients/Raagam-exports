import { requirePermission } from "@/lib/auth/server";
import { listExports } from "@/lib/integration/service";
import { EXPORT_TYPE_LABELS } from "@/lib/integration/types";
import type { TallyExport } from "@/lib/integration/types";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import type { Column } from "@/components/ui/data-table";
import { statusTone } from "@/lib/ui/status-tone";
import { ExportForm } from "./export-form";
import { withCreatedColumns } from "@/components/ui/created-columns";

// Generated is this export's own word (the file is ready); Failed is the table's.
const EXPORT_TONES = { generated: "success" } as const;

const columns: Column<TallyExport>[] = [
  { header: "Code", cell: (r) => r.code ?? "—" },
  {
    header: "Type",
    cell: (r) => EXPORT_TYPE_LABELS[r.export_type] ?? r.export_type,
  },
  {
    header: "Period",
    cell: (r) =>
      [r.period_start, r.period_end].filter(Boolean).join(" → ") || "—",
  },
  {
    header: "Records",
    align: "right",
    cell: (r) => r.record_count,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={statusTone(r.status, EXPORT_TONES)}>{r.status}</StatusPill>
    ),
  },
  { header: "Created", cell: (r) => fmtDate(r.created_at) },
];

export default async function TallyPage() {
  await requirePermission("integration", "view");

  const exports = await listExports();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Tally Export"
        description="Generate Tally Prime XML exports for voucher import. Admin and accounts staff trigger exports."
      />

      <ExportForm />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Export History
        </h2>
        <DataTable
          columns={withCreatedColumns(columns, exports)}
          rows={exports}
          getKey={(r) => r.id}
          onRowHref={(r) => `/integration/tally/${r.id}`}
          empty="No exports generated yet."
        />
      </div>
    </div>
  );
}
