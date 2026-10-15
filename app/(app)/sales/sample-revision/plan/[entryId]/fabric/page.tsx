import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getIwoFabricBomFormData, listIwoFabricBomTasks } from "@/lib/orders/iwo-fabric-bom/service";
import { listSwosAwaitingIw } from "@/lib/sales/sample-grouping/service";
import { getPlanRevisionEntry } from "@/lib/sales/plan-revisions/service";
import { planRevisionHref } from "@/lib/sales/plan-revisions/types";
import { PlanRevisionTabHeader } from "@/components/sales/plan-revision-tabs";
import { IwoFabricBomScreen } from "@/app/(app)/orders/iwo-fabric-bom/iwo-fabric-bom-screen";

/**
 * THE REVISION'S FABRIC PLAN TAB — Sample ▸ Fabric Plan's own editor, embedded
 * on the plan this revision reopened (Orders ▸ Order Revisions' module tabs,
 * `useEmbeddedEditor`). The same screen, data and permissions as the Sample
 * page; editable while the revision is being worked, locked by the plan's own
 * lock once it is with the approver or decided. Save and Cancel return here
 * to the Overview.
 */
export const metadata = { title: "Revision · Fabric Plan" };

export default async function PlanRevisionFabricTab({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("sales", "view");
  const { entryId } = await params;
  const [plans, tasks, data, swos, canCreate, canEdit, canDelete] = await Promise.all([
    getPlanRevisionEntry(entryId),
    listIwoFabricBomTasks({ sampleOnly: true }),
    getIwoFabricBomFormData(),
    listSwosAwaitingIw(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);
  const plan = plans.find((p) => p.kind === "fabric");
  if (!plan) notFound();
  return (
    <div className="space-y-3">
      <PlanRevisionTabHeader plans={plans} current="fabric" />
      <IwoFabricBomScreen
        sample
        swos={swos}
        tasks={tasks}
        data={data}
        perms={{ canCreate, canEdit, canDelete }}
        embed={{ id: plan.bomId, returnHref: planRevisionHref(entryId) }}
      />
    </div>
  );
}
