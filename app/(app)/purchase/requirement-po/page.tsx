import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  getBudgetedLineKeys,
  getDraftHolds,
  getItemClasses,
  getRequirementLines,
  getVendorsByClass,
  listRaisedPos,
  peekPoNumber,
} from "@/lib/purchase/re-po/service";
import { RaisePoScreen } from "./raise-po-screen";

/**
 * PURCHASE ▸ PROCUREMENT ▸ RAISE PO (doc/purchase/puchase.md; was "PO from
 * Requirement" until the user renamed it 2026-10-26).
 *
 * Every requirement line with something left to buy, and the bought-item vendors
 * of every class among them, load once — both are small (one row per RE · item ·
 * slice · colour), and the screen then filters in the browser with nothing to
 * wait on. The approved budget is NOT loaded: it is checked per line on the
 * server and never reaches this page (spec point 7).
 */
export default async function RequirementPoPage() {
  await requirePermission("materials_purchase", "create");
  // Every item class (the pill lists them all, 2026-10-26) does not wait on the lines.
  const [all, nextPoNo, itemClasses] = await Promise.all([getRequirementLines(), peekPoNumber(), getItemClasses()]);
  const lines = all.filter((l) => l.balance_qty > 0);
  // One round for the three: the vendors, which lines have an approved budget (the
  // Budget filter — asked with no rate, so no figure reaches the page), and the draft
  // POs already holding a balance.
  const [vendorsByClass, budgetedKeys, draftHolds, raised] = await Promise.all([
    getVendorsByClass(lines.map((l) => l.item_class_id).filter((v): v is string => !!v)),
    getBudgetedLineKeys(lines),
    getDraftHolds(),
    // The Updated / Draft lists (user 2026-10-26: Save stays on Raise PO).
    listRaisedPos(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Raise PO"
        description="Choose the item class and vendor, narrow with the filters, tick the orders. Type the rate."
      />
      <RaisePoScreen
        raised={raised}
        form={{ lines, vendorsByClass, nextPoNo, budgetedKeys, draftHolds, itemClasses }}
      />
    </div>
  );
}
