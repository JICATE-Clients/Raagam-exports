import Link from "next/link";
import {
  Layers,
  Wallet,
  AlertTriangle,
  Ship,
  FilePen,
  FileStack,
  FileText,
  Boxes,
  GitBranch,
  PackagePlus,
  Send,
  PackageCheck,
  FlaskConical,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

async function safeCount(table: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function PlanningPage() {
  await requirePermission("planning", "view");

  const [
    fabricBoms,
    materialBoms,
    draftBudgets,
    openShortages,
    shipmentPlans,
    budgetAmendments,
    bomAmendments,
    sqNotes,
    processAllocations,
    materialExcess,
    ppmIssues,
    stockCompletions,
    pdRequests,
  ] = await Promise.all([
    safeCount("fabric_boms"),
    safeCount("material_boms"),
    safeCount("budgets"),
    safeCount("material_shortages"),
    safeCount("shipment_plans"),
    safeCount("budget_amendments"),
    safeCount("bom_amendments"),
    safeCount("sq_notes"),
    safeCount("process_allocations"),
    safeCount("material_excess"),
    safeCount("ppm_issues"),
    safeCount("stock_completions"),
    safeCount("pd_requests"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planning"
        description="Bill of Materials and order budgeting"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/planning/boms" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Bill of Materials
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Fabric &amp; Material BOMs per order — component, colour and
                  size consumption, process loss, accessories.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {fabricBoms}
                  </span>{" "}
                  fabric ·{" "}
                  <span className="font-semibold text-foreground">
                    {materialBoms}
                  </span>{" "}
                  material
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/budgets" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Budgets
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Group orders, pull BOM lines, and approve budgets that
                  downstream to purchasing.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {draftBudgets}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/shortages" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Shortages
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Flag material &amp; garment gaps on an order, submit for
                  approval, and track resolution into purchasing.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {openShortages}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/shipment-plans" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Ship className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Shipment Plans
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Group orders into a planned shipping window before they hand
                  off to Logistics.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {shipmentPlans}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/budget-amendments" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <FilePen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Budget Amendments
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Formally revise an approved budget&apos;s total with an
                  approval trail.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {budgetAmendments}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/bom-amendments" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <FileStack className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  BOM Amendments
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Record and approve changes to a fabric or material BOM.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {bomAmendments}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/sq-notes" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">SQ Notes</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sample-quote notes with material/quantity allocation lines.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{sqNotes}</span> total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/iwo-boms" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  BOM for Internal Work Orders
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Prepare the material BOM for each internal work order.
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/process-allocations" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <GitBranch className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Purchase Process Allocation
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Allocate an order&apos;s outsourced process to a vendor with
                  qty and rate.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {processAllocations}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/material-excess" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Material Excess
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Order contingency/excess material and track its receipt.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {materialExcess}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/ppm" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Issue PPM</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Issue production-planning materials with line-wise receipts.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{ppmIssues}</span> total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/stock-completion" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PackageCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Stock Completion
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Close out planned stock for an order.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {stockCompletions}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/planning/product-dev" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <FlaskConical className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Product Development
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sample-development pipeline from acknowledge to packing list.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {pdRequests}
                  </span>{" "}
                  total
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
