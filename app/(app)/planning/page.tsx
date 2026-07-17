import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

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

// Planning module = two legacy sub-modules. Each is a hub page that lists its
// own task screens (the "master structure": module → sub-module → child).
export default async function PlanningPage() {
  await requirePermission("planning", "view");
  const pdRequests = await safeCount("pd_requests");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planning"
        description="Materials & BOM planning for garment orders, and the product-development pipeline."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HubCard
          href="/planning/garment-orders"
          title="Materials – Garment Orders"
          subtitle="Shipment plans, BOMs, budgets, shortages, PPM issue/cancellation and more."
        />
        <HubCard
          href="/planning/product-dev"
          title="Product Development"
          subtitle="Sample-development pipeline from acknowledge to packing list."
          count={pdRequests}
        />
      </div>
    </div>
  );
}
