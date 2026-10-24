import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getRequirementLines, getVendorsByClass, peekPoNumber } from "@/lib/purchase/re-po/service";
import { RequirementPoForm } from "./requirement-po-form";

/**
 * PURCHASE ▸ PROCUREMENT ▸ PO FROM REQUIREMENT (doc/purchase/puchase.md).
 *
 * Every requirement line with something left to buy, and the bought-item vendors
 * of every class among them, load once — both are small (one row per RE · item ·
 * slice · colour), and the screen then filters in the browser with nothing to
 * wait on. The approved budget is NOT loaded: it is checked per line on the
 * server and never reaches this page (spec point 7).
 */
export default async function RequirementPoPage() {
  await requirePermission("materials_purchase", "create");
  const [all, nextPoNo] = await Promise.all([getRequirementLines(), peekPoNumber()]);
  const lines = all.filter((l) => l.balance_qty > 0);
  const vendorsByClass = await getVendorsByClass(
    lines.map((l) => l.item_class_id).filter((v): v is string => !!v),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="PO from Requirement"
        description="Choose the item class and RE numbers; each RE opens from the left with what it still needs. Type the rate."
      />
      <RequirementPoForm lines={lines} vendorsByClass={vendorsByClass} nextPoNo={nextPoNo} />
    </div>
  );
}
