"use client";

import Link from "next/link";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtDate } from "@/lib/format";
import type { Column } from "@/components/ui/data-table";
import type { ApprovalItem, CrisisItem, TallyExport } from "@/lib/integration/types";
import { EXPORT_TYPE_LABELS } from "@/lib/integration/types";
import type { StatusTone } from "@/components/ui/status-pill";

interface Props {
  approvals: ApprovalItem[];
  crisisItems: CrisisItem[];
  recentExports: TallyExport[];
}

const approvalColumns: Column<ApprovalItem>[] = [
  { header: "Module", cell: (r) => r.module.replace(/_/g, " ") },
  { header: "Type", cell: (r) => r.label },
  { header: "Reference", cell: (r) => r.reference },
  {
    header: "Amount",
    align: "right",
    cell: (r) => (r.amount != null ? fmtMoney(r.amount) : "—"),
  },
  { header: "Date", cell: (r) => fmtDate(r.created_at) },
  {
    header: "",
    cell: (r) => (
      <Link href={r.href} className="text-blue-600 hover:underline text-sm">
        View
      </Link>
    ),
  },
];

const crisisToneMap: Record<CrisisItem["severity"], StatusTone> = {
  danger: "danger",
  warning: "warning",
};

const crisisColumns: Column<CrisisItem>[] = [
  {
    header: "Severity",
    cell: (r) => (
      <StatusPill tone={crisisToneMap[r.severity]}>{r.severity}</StatusPill>
    ),
  },
  { header: "Issue", cell: (r) => r.label },
  { header: "Reference", cell: (r) => r.reference },
  { header: "Date", cell: (r) => fmtDate(r.date) },
  {
    header: "",
    cell: (r) => (
      <Link href={r.href} className="text-blue-600 hover:underline text-sm">
        View
      </Link>
    ),
  },
];

const exportStatusTone: Record<TallyExport["status"], StatusTone> = {
  generated: "success",
  failed: "danger",
};

const exportColumns: Column<TallyExport>[] = [
  { header: "Code", cell: (r) => r.code ?? "—" },
  { header: "Type", cell: (r) => EXPORT_TYPE_LABELS[r.export_type] ?? r.export_type },
  {
    header: "Period",
    cell: (r) =>
      [r.period_start, r.period_end].filter(Boolean).join(" → ") || "—",
  },
  { header: "Records", align: "right", cell: (r) => r.record_count },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={exportStatusTone[r.status]}>{r.status}</StatusPill>
    ),
  },
  { header: "Created", cell: (r) => fmtDate(r.created_at) },
];

export function IntegrationTabs({ approvals, crisisItems, recentExports }: Props) {
  return (
    <Tabs
      items={[
        {
          key: "approvals",
          label: `Approvals (${approvals.length})`,
          content: (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Items pending approval across all modules. Action required by MD / management.
              </p>
              <DataTable
                columns={approvalColumns}
                rows={approvals}
                getKey={(_, i) => String(i)}
                empty="No pending approvals — all clear."
              />
            </div>
          ),
        },
        {
          key: "crisis",
          label: `Daily Summary (${crisisItems.length})`,
          content: (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Daily crisis digest — overdue milestones, late POs, pending amendments, negative stock.
              </p>
              <DataTable
                columns={crisisColumns}
                rows={crisisItems}
                getKey={(_, i) => String(i)}
                empty="No crisis items today — all on track."
              />
            </div>
          ),
        },
        {
          key: "tally",
          label: "Tally Export",
          content: (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Recent Tally exports. Admin &amp; accounts staff can generate new exports.
                </p>
                <Link
                  href="/integration/tally"
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  Go to Tally Export →
                </Link>
              </div>
              <DataTable
                columns={exportColumns}
                rows={recentExports}
                getKey={(r) => r.id}
                onRowHref={(r) => `/integration/tally/${r.id}`}
                empty="No exports generated yet."
              />
            </div>
          ),
        },
      ]}
    />
  );
}
