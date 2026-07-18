import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listColorPrintDetails } from "@/lib/planning/config-service";
import { ColorPrintClient } from "./color-print-client";

export default async function ColorPrintDetailsPage() {
  await requirePermission("planning", "view");
  const rows = await listColorPrintDetails();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Color/Print Details"
        description="Yarn dyeing, fabric dyeing, fabric print and garment design specifications."
      />
      <ColorPrintClient rows={rows} />
    </div>
  );
}
