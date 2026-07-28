import Link from "next/link";
import { FileText, Sheet, Printer, BarChart3 } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { REPORTS, reportHref } from "@/lib/reports/catalog";

/**
 * Reports landing. Each report is a page that renders a shared `<ReportView>` with
 * PDF / Excel / Print / chart affordances. Add new reports to `lib/reports/catalog.ts`
 * — this grid and the nav both read from it, so they cannot drift apart.
 */

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
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.slug} href={reportHref(r)} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {r.label}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.description}
                    </p>
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
