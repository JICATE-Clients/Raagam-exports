import Link from "next/link";
import { Layers, Wallet } from "lucide-react";
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

  const [fabricBoms, materialBoms, draftBudgets] = await Promise.all([
    safeCount("fabric_boms"),
    safeCount("material_boms"),
    safeCount("budgets"),
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
      </div>
    </div>
  );
}
