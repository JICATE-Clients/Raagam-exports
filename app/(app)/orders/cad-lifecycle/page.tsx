import { requirePermission, can } from "@/lib/auth/server";
import { listCadStyles, getCadLifecycleFormData } from "@/lib/orders/cad-lifecycle/service";
import { CadLifecycleScreen } from "./cad-lifecycle-screen";

/** Orders ▸ CAD ▸ CAD Lifecycle — see the screen's header (doc/order/cad.md, 0628). */
export default async function CadLifecyclePage() {
  await requirePermission("orders", "view");
  const [rows, form, canEdit] = await Promise.all([
    listCadStyles(),
    getCadLifecycleFormData(),
    can("orders", "edit"),
  ]);
  return <CadLifecycleScreen rows={rows} employees={form.employees} canEdit={canEdit} />;
}
