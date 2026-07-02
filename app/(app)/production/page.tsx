import Link from "next/link";
import { Settings2, ClipboardList, Percent, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import {
  listLines,
  getLineDashboard,
  getOrderProgress,
  getOrdersForPicker,
  getEntries,
} from "@/lib/production/service";
import { ProductionTabs } from "./production-tabs";

const operations = [
  { href: "/production/masters", label: "Planning Masters", desc: "Work types & sewing operations", icon: Settings2 },
  { href: "/production/job-orders", label: "Job Orders", desc: "Internal jobs + components", icon: ClipboardList },
  { href: "/production/piece-rates", label: "Piece Rates", desc: "Contractor rates (+approve)", icon: Percent },
  { href: "/production/packing-lists", label: "Packing Lists", desc: "Carton-wise packing", icon: PackageCheck },
  { href: "/production/inspections", label: "Inspections", desc: "Final QC pass/fail/rework", icon: ShieldCheck },
  { href: "/production/despatch", label: "Despatch", desc: "Handoff to Logistics", icon: Truck },
];

export default async function ProductionPage() {
  await requirePermission("production", "view");

  const today = new Date().toISOString().split("T")[0];

  const [lines, lineDashboard, orderProgress, ordersForPicker, pendingEntries] =
    await Promise.all([
      listLines(),
      getLineDashboard(today),
      getOrderProgress(),
      getOrdersForPicker(),
      getEntries({ status: "recorded" }),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production"
        description="Track cutting, sewing, and packing output across all lines"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {operations.map((op) => {
          const Icon = op.icon;
          return (
            <Link key={op.href} href={op.href} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{op.label}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{op.desc}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>

      <ProductionTabs
        lines={lines}
        lineDashboard={lineDashboard}
        orderProgress={orderProgress}
        ordersForPicker={ordersForPicker}
        pendingEntries={pendingEntries}
        today={today}
      />
    </div>
  );
}
