import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getPoRoutingData } from "@/lib/purchase/po-routing-service";
import { PoRoutingScreen } from "./po-routing-screen";

/**
 * PURCHASE ▸ PO APPROVAL ROUTING (user 2026-10-28: "in one ui screen create this
 * approval page in purchase module for this routing").
 *
 * Who approves a PO — per item class, above budget, and everything else — on one
 * screen. It edits the same purchase_order flows Approvals ▸ Flows shows
 * (lib/purchase/po-routing-model.ts), so there is still one routing, not two.
 */
export default async function PoApprovalRoutingPage() {
  await requirePermission("materials_purchase", "view");
  /* The flows' own read policy asks for approval access, so a Purchase user
     without it would read NO flows and see a routing that looks empty — a wrong
     answer that reads as a real one. Say so instead. */
  const [canView, canEdit] = await Promise.all([can("approvals", "view"), can("approvals", "edit")]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="PO Approval Routing"
        description="Who approves a purchase order — by item class, above budget, and everything else."
      />
      {canView ? (
        <PoRoutingScreen {...await getPoRoutingData()} canEdit={canEdit} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Seeing the routing needs Approvals access. Ask an administrator to give your role Approvals ▸ View.
        </p>
      )}
    </div>
  );
}
