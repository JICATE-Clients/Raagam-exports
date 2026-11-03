import { redirect } from "next/navigation";

/**
 * MORE THAN BUDGET APPROVAL IS PART OF PO APPROVAL NOW (user 2026-11-03: "merge these
 * two in one single screen"). An over-budget PO is the same PO with a budget block, so
 * it is decided on PO Approval with "Over budget" selected. The address stays so old
 * links, bookmarks and notices still land somewhere useful.
 */
export default function OverBudgetMoved() {
  redirect("/purchase/po-approval?budget=over");
}
