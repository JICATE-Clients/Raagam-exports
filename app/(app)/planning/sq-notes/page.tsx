import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listSqNotes, getOrdersForPicker, getBuyers } from "@/lib/planning/extras-service";
import { SqNotesClient } from "./sq-notes-client";

export default async function SqNotesPage() {
  await requirePermission("planning", "view");
  const [rows, orders, buyers, canCreate, canExport] = await Promise.all([
    listSqNotes(),
    getOrdersForPicker(),
    getBuyers(),
    can("planning", "create"),
    can("planning", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="SQ Notes & Allocation"
        description="Sample-quote notes with material/quantity allocation lines."
      />
      <SqNotesClient rows={rows} orders={orders} buyers={buyers} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
