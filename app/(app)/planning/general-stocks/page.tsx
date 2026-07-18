import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listGeneralStockGroups } from "@/lib/planning/config-service";
import { GeneralStocksClient } from "./general-stocks-client";

export default async function GeneralStocksPage() {
  await requirePermission("planning", "view");
  const rows = await listGeneralStockGroups();

  return (
    <div className="space-y-4">
      <PageHeader
        title="General Stocks"
        description="Stock group classification for planning lookups."
      />
      <GeneralStocksClient rows={rows} />
    </div>
  );
}
