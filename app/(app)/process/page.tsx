import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listJobs,
  getProcessors,
  getItems,
  getUoms,
  getOrdersForPicker,
  getFabricBomsForPicker,
  getDcsForPicker,
} from "@/lib/process/service";
import { ProcessTabs } from "./process-tabs";

export default async function ProcessPage() {
  await requirePermission("process_planning", "view");

  const [allJobs, processors, items, uoms, orders, fabricBoms, dcs] =
    await Promise.all([
      listJobs(),
      getProcessors(),
      getItems(),
      getUoms(),
      getOrdersForPicker(),
      getFabricBomsForPicker(),
      getDcsForPicker(),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process Planning"
        description="Manage outsourced processing job orders — knitting, dyeing, and finishing"
      />
      <ProcessTabs
        allJobs={allJobs}
        processors={processors}
        items={items}
        uoms={uoms}
        orders={orders}
        fabricBoms={fabricBoms}
        dcs={dcs}
      />
    </div>
  );
}
