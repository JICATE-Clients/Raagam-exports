import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getReturnableRequisitions, getReturnBins } from "@/lib/stores/department-return-service";
import { DepartmentReturnEditor } from "../_components/department-return-editor";

export default async function NewDepartmentReturnPage() {
  await requirePermission("stores", "create");
  const [requisitions, bins, canEdit] = await Promise.all([
    getReturnableRequisitions(),
    getReturnBins(),
    can("stores", "edit"),
  ]);
  return <DepartmentReturnEditor doc={null} lines={[]} requisitions={requisitions} bins={bins} today={today()} canEdit canPost={canEdit} />;
}
