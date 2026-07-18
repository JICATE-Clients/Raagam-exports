import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getOpportunities, getBuyers, getBrands, getSeasons } from "@/lib/sales/service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardBody } from "@/components/ui/card";
import { NewOpportunityForm } from "./new-opportunity-form";
import type { OpportunityRow } from "@/lib/sales/service";
import type { StatusTone } from "@/components/ui/status-pill";
import type { OpportunityStage } from "@/lib/sales/types";

// Map pipeline stage → display tone
const STAGE_TONE: Record<OpportunityStage, StatusTone> = {
  enquiry: "neutral",
  costing: "info",
  quoted: "warning",
  won: "success",
  lost: "danger",
};

export default async function SalesPipelinePage() {
  await requirePermission("sales", "view");

  const [opportunities, buyers, brands, seasons] = await Promise.all([
    getOpportunities(),
    getBuyers(),
    getBrands(),
    getSeasons(),
  ]);

  const columns: Column<OpportunityRow>[] = [
    {
      header: "Code",
      cell: (row) => (
        <Link
          href={`/sales/${row.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.code ?? "—"}
        </Link>
      ),
    },
    {
      header: "Title",
      cell: (row) => (
        <Link
          href={`/sales/${row.id}`}
          className="text-foreground hover:text-primary hover:underline"
        >
          {row.title}
        </Link>
      ),
    },
    {
      header: "Buyer",
      cell: (row) => (
        <span className="text-muted-foreground">{row.buyer_name ?? "—"}</span>
      ),
    },
    {
      header: "Season",
      cell: (row) => row.season ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Stage",
      cell: (row) => (
        <StatusPill tone={STAGE_TONE[row.stage]}>
          {row.stage.charAt(0).toUpperCase() + row.stage.slice(1)}
        </StatusPill>
      ),
    },
    {
      header: "Target FOB",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums">
          {fmtMoney(row.target_fob, row.currency_code)}
        </span>
      ),
    },
    {
      header: "Created",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {fmtDate(row.created_at)}
        </span>
      ),
    },
  ];

  const registers: { href: string; label: string; desc: string }[] = [
    { href: "/sales/registers?tab=cost-sheets", label: "Cost Sheets", desc: "All cost sheets across opportunities." },
    { href: "/sales/registers?tab=quotes", label: "Quotes", desc: "All quotes across opportunities." },
    { href: "/sales/registers?tab=samples", label: "Samples", desc: "All sample requests across opportunities." },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Pipeline"
        description="Track opportunities from enquiry to win"
        actions={
          <Link href="/sales/create">
            <Button variant="outline" size="sm">
              Create Opportunities
            </Button>
          </Link>
        }
      />

      {/* Cross-opportunity registers (also reachable from the opportunity tabs). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {registers.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="h-full cursor-pointer transition-colors hover:bg-surface-muted">
              <CardBody>
                <div className="font-semibold text-foreground">{r.label}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{r.desc}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <NewOpportunityForm buyers={buyers} brands={brands} seasons={seasons} />

      <DataTable
        columns={columns}
        rows={opportunities}
        getKey={(row) => row.id}
        empty="No opportunities yet. Create one to get started."
      />
    </div>
  );
}
