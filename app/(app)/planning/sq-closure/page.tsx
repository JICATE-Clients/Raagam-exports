import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listSqNotes } from "@/lib/planning/extras-service";
import { SqClosureClient } from "./sq-closure-client";

export default async function SqClosurePage() {
  await requirePermission("planning", "view");
  const [all, canEdit] = await Promise.all([
    listSqNotes(),
    can("planning", "edit"),
  ]);
  const rows = all.filter((r) => r.status === "allocated");
  return (
    <div className="space-y-4">
      <PageHeader
        title="SQ Closure"
        description="Close out an allocated SQ note with a closure reason once its allocation is fulfilled."
      />
      <SqClosureClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
