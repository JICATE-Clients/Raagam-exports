import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listLines,
  getLineDashboard,
  getOrderProgress,
  getOrdersForPicker,
  getEntries,
} from "@/lib/production/service";
import { ProductionTabs } from "./production-tabs";

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
