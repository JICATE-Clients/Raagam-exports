import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  getDraftHolds,
  getItemClasses,
  getRequirementLines,
  getVendorsByClass,
  listRaisedPos,
  peekPoNumber,
  withApprovedBudgets,
} from "@/lib/purchase/re-po/service";
import { getGstPlaces } from "@/lib/purchase/re-po/gst-place";
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
  // Where the unit and each vendor are registered decides CGST + SGST vs IGST (2026-10-31).
  const [all, nextPoNo, itemClasses, gstPlaces] = await Promise.all([
    getRequirementLines(),
    peekPoNumber(),
    getItemClasses(),
    getGstPlaces(),
  ]);
  // Only orders whose budget is approved (withApprovedBudgets); the budgeted keys are the
  // Budget filter — asked with no rate, so no figure reaches the page.
  // Vendors are read for every class with a balance, not only the approved orders' — one
  // round instead of two; a class nobody lists is never looked up.
  const open = all.filter((l) => l.balance_qty > 0);
  const [{ lines, budgetedKeys }, vendorsByClass, draftHolds, raised] = await Promise.all([
    withApprovedBudgets(open),
    getVendorsByClass(open.map((l) => l.item_class_id).filter((v): v is string => !!v)),
    getDraftHolds(),
    // The Updated / Draft lists (user 2026-10-26: Save stays on Raise PO).
    listRaisedPos(),
  ]);

  return (
    /* NO FLOATING "← Back" OVER THE OPEN EDITOR (user 2026-10-31). PageHeader floats its Back
       right so a list's toolbar rises beside it; the PO editor is one full-width card, so the
       link sat on the card's top-right border. The editor's Cancel is its way out (AGENTS,
       "One job, one button"), so the Back row hides while the editor is open; the header's
       screen-reader title stays. The list view keeps its Back as before. */
    <div className="space-y-4 [&:has([data-rpo-editor])>[data-focus-region=header]>div]:hidden">
      <PageHeader
        title="Raise PO"
        description="Choose the item class and vendor, narrow with the filters, tick the orders. Type the rate."
      />
      <RaisePoScreen
        raised={raised}
        form={{ lines, vendorsByClass, nextPoNo, budgetedKeys, draftHolds, itemClasses, gstPlaces }}
      />
    </div>
  );
}
