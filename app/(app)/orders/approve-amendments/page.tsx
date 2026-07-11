import { requirePermission, can } from "@/lib/auth/server";
import { getAmendmentApprovals } from "@/lib/orders/approve-amendments/service";
import { ApproveAmendmentScreen } from "./approve-amendment-screen";

export default async function ApproveAmendmentsPage() {
  await requirePermission("orders", "view");

  const [rows, canDecide] = await Promise.all([
    getAmendmentApprovals(),
    can("orders", "edit"),
  ]);

  return <ApproveAmendmentScreen rows={rows} canDecide={canDecide} />;
}
