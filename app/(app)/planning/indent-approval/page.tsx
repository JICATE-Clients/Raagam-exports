import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listIndentApprovals } from "@/lib/planning/indent-service";
import { IndentApprovalClient } from "./indent-approval-client";

export default async function IndentApprovalPage() {
  await requirePermission("planning", "view");
  const rows = await listIndentApprovals();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Indent Approval"
        description="Multi-level approval workflow for material indents."
      />
      <IndentApprovalClient rows={rows} />
    </div>
  );
}
