import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import {
  getIwoMaterialBomFormData,
  listIwoMaterialBomTasks,
  listSwosAwaitingAccessoriesIw,
} from "@/lib/orders/iwo-material-bom/service";
import { getPlanRevisionEntry } from "@/lib/sales/plan-revisions/service";
import { planRevisionHref } from "@/lib/sales/plan-revisions/types";
import { PlanRevisionTabHeader } from "@/components/sales/plan-revision-tabs";
import { IwoMaterialBomScreen } from "@/app/(app)/orders/iwo-material-bom/iwo-material-bom-screen";

/**
 * THE REVISION'S ACCESSORIES PLAN TAB — Sample ▸ Accessories Plan's own
 * editor, embedded on the plan this revision reopened (`useEmbeddedEditor`).
 * The same screen, data and permissions as the Sample page (the Colour and
 * Size pickers edit a master list, hence `masters`). Save and Cancel return
 * here to the Overview.
 */
export const metadata = { title: "Revision · Accessories Plan" };

export default async function PlanRevisionAccessoriesTab({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("sales", "view");
  const { entryId } = await params;
  const [plans, tasks, swos, data, canCreate, canEdit, canDelete, mCreate, mEdit] = await Promise.all([
    getPlanRevisionEntry(entryId),
    listIwoMaterialBomTasks({ sampleOnly: true }),
    listSwosAwaitingAccessoriesIw(),
    getIwoMaterialBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    can("masters", "create"),
    can("masters", "edit"),
  ]);
  const plan = plans.find((p) => p.kind === "accessories");
  if (!plan) notFound();
  return (
    <div className="space-y-3">
      <PlanRevisionTabHeader plans={plans} current="accessories" />
      <IwoMaterialBomScreen
        sample
        swos={swos}
        tasks={tasks}
        data={data}
        perms={{ canCreate, canEdit, canDelete }}
        masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
        embed={{ id: plan.bomId, returnHref: planRevisionHref(entryId) }}
      />
    </div>
  );
}
