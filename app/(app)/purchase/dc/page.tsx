import { can, requirePermission } from "@/lib/auth/server";
import { listDcRegister } from "@/lib/purchase/dc-register";
import { PageHeader } from "@/components/ui/page-header";
import { DcRegisterScreen } from "./_components/dc-register-screen";

/**
 * PURCHASE ▸ DELIVERY CHALLANS — every DC in one register (user 2026-10-31, screenshot 3949:
 * "DC should list rejection, production etc."). It used to read only job-work DCs, so the
 * Rejection / Replacement DCs a GRN raises and every Production DC were missing here.
 */
export default async function DcListPage() {
  await requirePermission("materials_purchase", "view");
  const [rows, canCreate] = await Promise.all([listDcRegister(), can("stores", "create")]);
  return (
    <div className="space-y-4">
      <PageHeader title="Delivery Challans" description="Every DC — job work, unit transfers, rejections and replacements" />
      <DcRegisterScreen rows={rows} canCreate={canCreate} />
    </div>
  );
}
