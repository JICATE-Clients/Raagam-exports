import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listIndentConversions } from "@/lib/planning/indent-service";
import { IndentToPurchaseClient } from "./indent-to-purchase-client";

export default async function IndentToPurchasePage() {
  await requirePermission("planning", "view");
  const rows = await listIndentConversions();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Indent to Purchase"
        description="Convert approved indents into purchase orders with vendor and rate assignment."
      />
      <IndentToPurchaseClient rows={rows} />
    </div>
  );
}
