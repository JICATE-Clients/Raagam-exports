import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPdRequests, getBuyers, getOpportunities } from "@/lib/planning/extras-service";
import { ProductDevClient } from "./product-dev-client";

export default async function ProductDevPage() {
  await requirePermission("planning", "view");
  const [rows, buyers, opportunities, canCreate, canExport] = await Promise.all([
    listPdRequests(),
    getBuyers(),
    getOpportunities(),
    can("planning", "create"),
    can("planning", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Product Development"
        description="Sample-development pipeline: acknowledge → group → processes → sample → dispatch → packing list."
      />
      <ProductDevClient
        rows={rows}
        buyers={buyers}
        opportunities={opportunities}
        canCreate={canCreate}
        canExport={canExport}
      />
    </div>
  );
}
