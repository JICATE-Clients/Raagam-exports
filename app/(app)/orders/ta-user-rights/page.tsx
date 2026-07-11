import { requirePermission, can } from "@/lib/auth/server";
import {
  getTaUserRightsFormData,
  getAllTaUserRights,
  getTaUserRightsSummary,
} from "@/lib/orders/ta-user-rights/service";
import { TaUserRightsScreen } from "./ta-user-rights-screen";

export default async function TaUserRightsPage() {
  await requirePermission("system_admin", "view");

  const [data, allRights, summary, canEdit] = await Promise.all([
    getTaUserRightsFormData(),
    getAllTaUserRights(),
    getTaUserRightsSummary(),
    can("system_admin", "edit"),
  ]);

  return (
    <TaUserRightsScreen
      data={data}
      allRights={allRights}
      summary={summary}
      canEdit={canEdit}
    />
  );
}
