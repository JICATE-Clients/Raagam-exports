import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listAllCostSheets,
  listAllQuotes,
  listAllSamples,
} from "@/lib/sales/extras-service";
import { SalesRegistersClient } from "./registers-client";

export default async function SalesRegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("sales", "view");
  const { tab } = await searchParams;

  const [costSheets, quotes, samples] = await Promise.all([
    listAllCostSheets(),
    listAllQuotes(),
    listAllSamples(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Registers"
        description="Cross-opportunity views of cost sheets, quotes and samples."
      />
      <SalesRegistersClient
        costSheets={costSheets}
        quotes={quotes}
        samples={samples}
        initialTab={tab}
      />
    </div>
  );
}
