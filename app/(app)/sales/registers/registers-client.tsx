"use client";

import Link from "next/link";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";
import type { CostSheetRow, QuoteRow, SampleRow } from "@/lib/sales/extras-service";

function statusTone(s: string): StatusTone {
  const v = s.toLowerCase();
  if (["approved", "accepted", "won", "sent"].includes(v)) return "success";
  if (["rejected", "lost", "cancelled"].includes(v)) return "danger";
  if (["submitted", "quoted", "in_progress"].includes(v)) return "info";
  return "neutral";
}

function oppCell(id: string | null, title: string | null, code: string | null) {
  if (!id) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <Link href={`/sales/${id}`} className="text-sm text-primary hover:underline">
      {code ? `${code} · ` : ""}
      {title ?? id.slice(0, 8)}
    </Link>
  );
}

interface Props {
  costSheets: CostSheetRow[];
  quotes: QuoteRow[];
  samples: SampleRow[];
  initialTab?: string;
}

export function SalesRegistersClient({ costSheets, quotes, samples, initialTab }: Props) {
  const csColumns: Column<CostSheetRow>[] = [
    { header: "Opportunity", cell: (r) => oppCell(r.opportunity_id, r.opportunity_title, r.opportunity_code) },
    { header: "Version", align: "right", cell: (r) => <span className="tabular-nums text-sm">v{r.version}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status || "—"}</StatusPill> },
    { header: "Created", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span> },
  ];
  const qColumns: Column<QuoteRow>[] = [
    { header: "Opportunity", cell: (r) => oppCell(r.opportunity_id, r.opportunity_title, r.opportunity_code) },
    { header: "FOB price", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.fob_price)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status || "—"}</StatusPill> },
    { header: "Created", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span> },
  ];
  const sColumns: Column<SampleRow>[] = [
    { header: "Opportunity", cell: (r) => oppCell(r.opportunity_id, r.opportunity_title, r.opportunity_code) },
    { header: "Type", cell: (r) => <span className="text-sm uppercase">{r.type || "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status || "—"}</StatusPill> },
    { header: "Created", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span> },
  ];

  const tabs = [
    {
      key: "cost-sheets",
      label: `Cost Sheets (${costSheets.length})`,
      content: <DataTable columns={csColumns} rows={costSheets} getKey={(r) => r.id} empty="No cost sheets yet." />,
    },
    {
      key: "quotes",
      label: `Quotes (${quotes.length})`,
      content: <DataTable columns={qColumns} rows={quotes} getKey={(r) => r.id} empty="No quotes yet." />,
    },
    {
      key: "samples",
      label: `Samples (${samples.length})`,
      content: <DataTable columns={sColumns} rows={samples} getKey={(r) => r.id} empty="No samples yet." />,
    },
  ];

  const activeTab = initialTab && tabs.some((t) => t.key === initialTab) ? initialTab : "cost-sheets";

  return <Tabs key={activeTab} items={tabs} defaultKey={activeTab} />;
}
