import Link from "next/link";
import { TrendingUp, FileText, Sheet, Printer, BarChart3 } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Reports landing. Each report is a page that renders a shared `<ReportView>` with
 * PDF / Excel / Print / chart affordances. Add new reports here + in nav.ts.
 */
const reports = [
  {
    href: "/reports/shipment-pnl",
    label: "Shipment P&L",
    desc: "Profitability by shipment — revenue vs. total cost",
    icon: TrendingUp,
  },
];

export default async function ReportsPage() {
  await requirePermission("reports", "view");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports & Analytics"
        description="Export to PDF/Excel, print, or visualise any report as a chart"
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> PDF
        </span>
        <span className="inline-flex items-center gap-1">
          <Sheet className="h-3.5 w-3.5" /> Excel
        </span>
        <span className="inline-flex items-center gap-1">
          <Printer className="h-3.5 w-3.5" /> Print
        </span>
        <span className="inline-flex items-center gap-1">
          <BarChart3 className="h-3.5 w-3.5" /> Charts
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {r.label}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
